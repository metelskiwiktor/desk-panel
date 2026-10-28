"""Isolated real HTTP MCP reconnect probe; no model, production config or service.

Run with the Python interpreter from the pinned Hermes environment:
    python scripts/hermes-mcp-recovery-probe.py --source C:/path/to/hermes-agent
Use --interval 300 for the pinned production probe cadence. The server and Hermes
client are subprocess-local and use a disposable home; no task is sent to Cezar.
"""
import argparse
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace


def wait_for(predicate, timeout):
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        if predicate():
            return True
        time.sleep(0.1)
    return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--interval', type=int, default=15)
    args = parser.parse_args()
    source = args.source.resolve()
    fixture = source / 'tests/e2e/core/mcp_plugins/mcp_fixture_server.py'
    if not fixture.is_file() or not 1 <= args.interval <= 300:
        parser.error('pinned Hermes source fixture required; interval must be 1..300')

    # Drop inherited provider credentials, production home/config and Python startup options.
    safe = {k: v for k, v in os.environ.items() if k.upper() in {'SYSTEMROOT', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC'}}
    os.environ.clear()
    os.environ.update(safe)
    sys.dont_write_bytecode = True
    with tempfile.TemporaryDirectory(prefix='desk-hermes-mcp-') as tmp:
        root = Path(tmp)
        home = root / 'hermes'
        home.mkdir()
        os.environ.update({'HOME': tmp, 'USERPROFILE': tmp, 'LOCALAPPDATA': tmp, 'APPDATA': tmp,
                           'HERMES_HOME': str(home), 'TEMP': tmp, 'TMP': tmp, 'PYTHONDONTWRITEBYTECODE': '1'})
        sys.path.insert(0, str(source))
        from tools import mcp_tool
        from tools.mcp_tool_discovery import register_mcp_servers
        from tools.mcp_tool_handlers import _make_tool_handler
        from tools.mcp_tool_lifecycle import shutdown_mcp_servers

        mcp_tool._MAX_RECONNECT_RETRIES = 1  # accelerate entry into parked state, not its retry interval
        mcp_tool._PARKED_RETRY_INTERVAL = args.interval
        port_file = root / 'port.txt'
        child_env = dict(os.environ, MCPE2E_TRANSPORT='http', MCPE2E_PORT_FILE=str(port_file),
                         MCPE2E_PORT='0', MCPE2E_LOG=str(root / 'wire.jsonl'), MCPE2E_CANARY='ISOLATED')
        child_env['PYTHONPATH'] = str(source)
        process = None

        def start(port=0):
            port_file.unlink(missing_ok=True)
            child_env['MCPE2E_PORT'] = str(port)
            p = subprocess.Popen([sys.executable, str(fixture)], env=child_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if not wait_for(lambda: port_file.exists() or p.poll() is not None, 30) or p.poll() is not None:
                p.terminate()
                p.wait(timeout=10)
                raise RuntimeError('isolated MCP server did not start')
            return p, int(port_file.read_text().split()[0])

        try:
            process, port = start()
            config = {'fixture': {'url': f'http://127.0.0.1:{port}/mcp', 'connect_timeout': 5, 'timeout': 5, 'trusted': True}}
            (home / 'config.yaml').write_text(f'mcp_servers:\n  fixture:\n    url: http://127.0.0.1:{port}/mcp\n    trusted: true\n', encoding='utf-8')
            register_mcp_servers(config)
            task = mcp_tool._servers['fixture']
            call = _make_tool_handler('fixture', 'ro_probe', 5)
            assert 'RO:ISOLATED:before' in str(call({'nonce': 'before'})), 'initial call failed'
            print('PASS initial real MCP call', flush=True)
            process.terminate()
            process.wait(timeout=10)
            assert 'error' in str(call({'nonce': 'during'})).lower(), 'outage was not reported'
            assert wait_for(lambda: task.session is None, 25), 'connection did not become unavailable'
            print('PASS real outage detected', flush=True)
            agent = SimpleNamespace(tools=[], valid_tool_names=set(), enabled_toolsets=['mcp-fixture'], disabled_toolsets=None)
            process, _ = start(port)
            started = time.monotonic()
            assert wait_for(lambda: task.session is not None and task._ready.is_set(), args.interval + 30), 'connection did not recover'
            elapsed = time.monotonic() - started
            assert 'RO:ISOLATED:after' in str(call({'nonce': 'after'})), 'call after recovery failed'
            from agent.turn_context import _refresh_mcp_tools_between_turns
            from agent.tool_executor import _tool_search_scoped_names
            _refresh_mcp_tools_between_turns(agent)
            assert 'mcp__fixture__ro_probe' in _tool_search_scoped_names(agent), 'tool absent from deferred catalog'
            print(f'PASS recovery and deferred catalog: {elapsed:.1f}s after server restart (interval {args.interval}s)', flush=True)
            print('SKIP real model conversation, production service, production credentials', flush=True)
        finally:
            shutdown_mcp_servers()
            if process is not None and process.poll() is None:
                process.terminate()
                process.wait(timeout=10)


if __name__ == '__main__':
    main()
