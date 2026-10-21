import argparse
import logging
import os
import sys

from jobbuddy_workers import __version__


def _env() -> dict[str, str]:
    from dotenv import load_dotenv

    load_dotenv()
    return dict(os.environ)


def _require(env: dict[str, str], *names: str) -> None:
    missing = [n for n in names if not env.get(n)]
    if missing:
        sys.exit(f"Missing env variables: {', '.join(missing)}")


def cmd_fetch(args: argparse.Namespace) -> int:
    from jobbuddy_workers.embed import FastEmbedder
    from jobbuddy_workers.http import Http
    from jobbuddy_workers.jobs.run import Runner
    from jobbuddy_workers.jobs.store import SupabaseStore

    env = _env()
    _require(env, "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
    store = SupabaseStore(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
    http = Http()
    try:
        results = Runner(store, http, FastEmbedder(), env).run(only=args.source or None)
    finally:
        http.close()
    for name, s in results.items():
        print(
            f"{name:16} seen {s.seen:5}  new {s.new:4}  updated {s.updated:4}  "
            f"closed {s.closed:4}  errors {len(s.errors)}"
        )
    # Partial failures are normal (a company board down); fail only if everything failed.
    return 1 if results and all(s.errors and s.seen == 0 for s in results.values()) else 0


def cmd_seed(args: argparse.Namespace) -> int:
    from jobbuddy_workers.seed.companies import seed

    env = _env()
    _require(env, "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
    return seed(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"], dry_run=args.dry_run)


def cmd_discover(args: argparse.Namespace) -> int:
    from jobbuddy_workers.discover.run import CommonCrawl, discover, live_check
    from jobbuddy_workers.discover.store import SupabaseDiscoveryStore
    from jobbuddy_workers.http import Http

    env = _env()
    _require(env, "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
    store = SupabaseDiscoveryStore(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
    http = Http(retries=1)
    try:
        report = discover(
            store,
            lambda ats, slug: live_check(ats, slug, http),
            None if args.no_common_crawl else CommonCrawl(),
        )
    finally:
        http.close()
    print(f"New candidates per system: {report.candidates}")
    print(f"Checked {report.checked}; added {report.added}")
    print(f"Deactivated {report.deactivated}; reactivated {report.reactivated}")
    return 0


def cmd_match(args: argparse.Namespace) -> int:
    from jobbuddy_workers.embed import FastEmbedder
    from jobbuddy_workers.match.run import run_matcher
    from jobbuddy_workers.match.store import SupabaseMatchStore

    env = _env()
    _require(env, "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
    store = SupabaseMatchStore(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
    report = run_matcher(store, FastEmbedder())
    print(
        f"users {report.users}  jobs scored {report.jobs_scored}  stored {report.stored}  "
        f"hot {report.hot}  summaries {report.summaries}  errors {len(report.errors)}"
    )
    return 1 if report.users and len(report.errors) == report.users else 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(prog="jobbuddy-workers")
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command")

    fetch = sub.add_parser("fetch", help="Fetch jobs from all sources")
    fetch.add_argument("--source", action="append", help="Only this source (repeatable)")
    fetch.set_defaults(func=cmd_fetch)

    seed = sub.add_parser("seed-companies", help="Verify and insert the starter company list")
    seed.add_argument("--dry-run", action="store_true")
    seed.set_defaults(func=cmd_seed)

    match = sub.add_parser("match", help="Score new or changed jobs for every user")
    match.set_defaults(func=cmd_match)
    disc = sub.add_parser("discover", help="Find new companies on employer systems")
    disc.add_argument(
        "--no-common-crawl", action="store_true", help="Only use links in stored jobs"
    )
    disc.set_defaults(func=cmd_discover)

    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 0
    if not hasattr(args, "func"):
        print(f"'{args.command}' is not built yet.")
        return 1
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
