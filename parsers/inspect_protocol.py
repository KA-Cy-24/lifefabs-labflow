"""Command-line entry point for the same reader used in the browser."""
import json
from opentrons_ast import analyse

if __name__ == "__main__":
    from pathlib import Path
    import argparse
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('protocol', type=Path)
    cli.add_argument('--ordering', type=Path, help='JSON mapping load names to ordered columns')
    options = cli.parse_args()
    definitions = json.loads(options.ordering.read_text(encoding="utf-8-sig")) if options.ordering else {}
    print(json.dumps(analyse(options.protocol.read_text(encoding='utf-8-sig'), definitions), indent=2))
