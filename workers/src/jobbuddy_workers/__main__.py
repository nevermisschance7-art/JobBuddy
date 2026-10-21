import argparse

from jobbuddy_workers import __version__


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="jobbuddy-workers")
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("fetch", help="Fetch jobs from all sources (prompt 4)")
    sub.add_parser("match", help="Score new jobs for every user (prompt 6)")
    sub.add_parser("discover", help="Find new companies on employer systems (prompt 5)")

    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 0
    print(f"'{args.command}' is not built yet.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
