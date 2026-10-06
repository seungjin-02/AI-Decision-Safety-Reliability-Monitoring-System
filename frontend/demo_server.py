"""Start the real application against a new, explicitly isolated demo DB."""
import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True, help="New demo DB path; existing files are refused")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    database = args.db.resolve()
    if database.exists() or database == (ROOT / "data" / "alerts.db").resolve():
        parser.error("Use a new demo DB path. Existing/default databases will not be opened.")
    database.parent.mkdir(parents=True, exist_ok=True)
    import app.main as application
    import uvicorn
    application.DATABASE_PATH = database
    print(f"DEMO_DATABASE_PATH={database}", flush=True)
    uvicorn.run(application.app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
