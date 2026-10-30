"""Probe the pinned Hermes MCP bridge in memory and a temporary source copy; no services or models."""
import argparse
import ast
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from contextvars import ContextVar
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from types import ModuleType, SimpleNamespace

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    patcher = root / "scripts/hermes-mcp-turn-context.py"
    spec = importlib.util.spec_from_file_location("bridge", patcher)
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)
    source = (args.source / "tools/mcp_tool_handlers.py").read_text(encoding="utf-8")
    lock = json.loads((root / "servy/hermes.lock.json").read_text(encoding="utf-8"))["mcpTurnContextPatch"]
    import hashlib
    result = source if hashlib.sha256(source.encode()).hexdigest() == lock["resultSha256"] else bridge.patched(source)
    assert hashlib.sha256(result.encode()).hexdigest() == lock["resultSha256"]
    # Exercise the actual apply/check/hash refusal path against a disposable copy only.
    with tempfile.TemporaryDirectory(prefix="desk-mcp-context-") as tmp:
        copy = Path(tmp)
        target = copy / lock["target"]
        target.parent.mkdir(parents=True)
        target.write_text(source, encoding="utf-8", newline="\n")
        for flags in [("--apply",), ()]:
            subprocess.run([sys.executable, str(patcher), "--source", str(copy), *flags], check=True)
        target.write_text(result + "# unexpected change\n", encoding="utf-8")
        bad = subprocess.run([sys.executable, str(patcher), "--source", str(copy), "--apply"], capture_output=True)
        assert bad.returncode != 0
        assert target.read_text(encoding="utf-8") == result + "# unexpected change\n"

    # Run the two patched functions themselves, with just the external runtime dependencies stubbed.
    # Caller ContextVars are captured on two concurrent agent threads; transport runs on a third shared thread.
    tree = ast.parse(result)
    wanted = {"_call_tool_racing_stdio_death", "_make_tool_handler"}
    nodes = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in wanted]
    assert len(nodes) == 2
    key = ContextVar("native_run", default="")
    approval = ModuleType("tools.approval_context")
    approval._approval_session_key = key
    sys.modules["tools.approval_context"] = approval
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    calls = []
    async def call_tool(name, *, arguments, **kwargs):
        calls.append((name, arguments, kwargs, threading.get_ident()))
        return "ok"
    server = SimpleNamespace(session=SimpleNamespace(call_tool=call_tool), _rpc_lock=asyncio.Lock())
    @asynccontextmanager
    async def track(*a, **kw):
        yield
    def dispatch(server_name, server, op, call, timeout, handlers, on_failure, **kw):
        return asyncio.run_coroutine_threadsafe(call(), loop).result(timeout=5)
    namespace = dict(
        Any=object, asyncio=asyncio, contextvars=__import__('contextvars'), inspect=__import__("inspect"),
        _trust_gate_check=lambda *a: None, _check_circuit_breaker=lambda *a: None,
        _acquire_call_server=lambda *a: (server, None), _tool_is_read_only=lambda *a: True,
        _track_inflight_rpc=track, _dispatch=dispatch,
        _render_call_tool_result=lambda result, *a: result,
        _mcp_result_with_native_images=lambda text, *a: text, _result_is_error=lambda text: False,
        partial=__import__("functools").partial,
        _handle_session_expired_and_retry=lambda *a, **kw: None,
        _handle_stdio_child_exited_and_retry=None, _handle_auth_error_and_retry=None,
    )
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "<patched-hermes-mcp>", "exec"), namespace)
    handler = namespace["_make_tool_handler"]("desk-panel", "panel_automation_report", 5)
    barrier = threading.Barrier(2)
    def invoke(run_id):
        token = key.set(run_id)
        try:
            barrier.wait(timeout=5)
            assert handler({"runId": "automation", "spoof": "wrong-run"}) == "ok"
        finally:
            key.reset(token)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(invoke, ["native-a", "native-b"]))
        assert {c[2]["meta"]["desk-panel/run-id"] for c in calls} == {"native-a", "native-b"}
        assert all(c[3] == thread.ident for c in calls)
        # No active run: no metadata fabricated from env or arguments.
        assert handler({"runId": "native-a"}) == "ok"
        assert calls[-1][2] == {}
    finally:
        loop.call_soon_threadsafe(loop.stop)
        thread.join(timeout=5)
        loop.close()
    print("PASS: pinned patch apply/check/refusal; concurrent caller identity; shared loop; missing context fails closed.")

if __name__ == "__main__":
    main()
