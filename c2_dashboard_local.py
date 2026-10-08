"""Build C2 and run the existing FastAPI app with an isolated local demo DB."""
import argparse
from pathlib import Path
import socket
import sqlite3

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, help='Explicit isolated DB path; a new path starts empty')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    database = (args.db if args.db is not None else ROOT / 'data/c2-demo.db').resolve()
    user_database = (ROOT / 'data/alerts.db').resolve()
    if database == user_database or (
        database.exists() and user_database.exists() and database.samefile(user_database)
    ):
        parser.error('The project user DB data/alerts.db is not a demo DB.')
    if args.db is None and not database.is_file():
        parser.error('Missing data/c2-demo.db. Restore the local demo DB or specify --db explicitly.')
    if not 1 <= args.port <= 65535:
        parser.error('Port must be 1..65535.')
    rows = 0
    if database.exists():
        if not database.is_file():
            parser.error('The demo DB path must be a file.')
        try:
            with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as connection:
                rows = connection.execute('SELECT COUNT(*) FROM alerts').fetchone()[0]
        except sqlite3.Error as error:
            parser.error(f'Cannot read the existing demo DB: {error}')
    # Report a port conflict before building files or starting DB initialization.
    try:
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', args.port))
    except OSError:
        parser.error(f'Port {args.port} is unavailable. Stop the previous server or use --port.')

    from frontend.build_web import build
    import app.main as application
    import uvicorn

    build(ROOT / 'frontend')
    database.parent.mkdir(parents=True, exist_ok=True)
    application.DATABASE_PATH = database
    print(f'DEMO_DATABASE_PATH={database}', flush=True)
    print(f'DEMO_ROWS={rows}', flush=True)
    print(f'DASHBOARD_URL=http://127.0.0.1:{args.port}/dashboard/', flush=True)
    uvicorn.run(application.app, host='127.0.0.1', port=args.port)


if __name__ == '__main__':
    main()
