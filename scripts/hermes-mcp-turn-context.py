"""Check/apply the pinned MCP caller-context bridge. No service or credential access."""
import argparse
import hashlib
import json
from pathlib import Path

CHANGES = [('async def _call_tool_racing_stdio_death(server, server_name: str, tool_name: str, args: dict):',
  'async def _call_tool_racing_stdio_death(server, server_name: str, tool_name: str, args: dict, '
  '*, caller_run_id: str = ""):'),
 ('    _call_coro = server.session.call_tool(tool_name, arguments=args)',
  '    # Stamped by the Hermes runtime, never copied from model arguments.\n'
  '    call_context = {"meta": {"desk-panel/run-id": caller_run_id}} if server_name == '
  '"desk-panel" and caller_run_id else {}\n'
  '    _call_coro = server.session.call_tool(tool_name, arguments=args, **call_context)'),
 ('        read_only = _tool_is_read_only(server_name, tool_name)',
  '        read_only = _tool_is_read_only(server_name, tool_name)\n'
  '        # Capture on the invoking agent thread before dispatch to the shared MCP loop.\n'
  '        # /v1/runs binds this ContextVar to its native run_id in _run_agent_sync.\n'
  '        from tools.approval_context import _approval_session_key\n'
  '        caller_run_id = _approval_session_key.get()'),
 ('result = await _call_tool_racing_stdio_death(server, server_name, tool_name, args)',
  'result = await _call_tool_racing_stdio_death(server, server_name, tool_name, args, '
  'caller_run_id=caller_run_id)')]

def patched(source):
    for before, after in CHANGES:
        if source.count(before) != 1:
            raise ValueError("Hermes MCP source differs from the pinned bridge anchors")
        source = source.replace(before, after)
    compile(source, "mcp_tool_handlers.py", "exec")
    return source

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Hermes source checkout")
    parser.add_argument("--apply", action="store_true", help="Explicitly apply; default only verifies")
    args = parser.parse_args()
    lock = json.loads((Path(__file__).resolve().parents[1] / "servy/hermes.lock.json").read_text(encoding="utf-8"))["mcpTurnContextPatch"]
    target = args.source / lock["target"]
    source = target.read_text(encoding="utf-8")
    digest = lambda text: hashlib.sha256(text.encode("utf-8")).hexdigest()
    if digest(source) == lock["resultSha256"]:
        print("MCP turn context: verified.")
        return
    if digest(source) != lock["baseSha256"]:
        raise ValueError("Hermes MCP source hash differs from lock; nothing changed")
    if not args.apply:
        raise ValueError("MCP turn context bridge is not applied")
    result = patched(source)
    if digest(result) != lock["resultSha256"]:
        raise ValueError("MCP bridge result hash differs from lock; nothing changed")
    temporary = target.with_suffix(".py.tmp")
    temporary.write_text(result, encoding="utf-8", newline="\n")
    temporary.replace(target)
    print("MCP turn context: applied and verified.")

if __name__ == "__main__":
    main()
