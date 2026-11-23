"""Manual network regression against the unmodified upstream protocol.

Official source is data only. Never import or run downloaded protocol files.
Pass --bca to also check the unmodified downloaded Flex assay.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'parsers'))
from opentrons_ast import analyse

RAW = 'https://raw.githubusercontent.com/Opentrons/'
SLUG = 'sci-lucif-assay3'


def fetch(url):
    with urlopen(url, timeout=12) as response:
        return response.read(250_001)


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--bca', type=Path)
    opts = cli.parse_args()
    if opts.bca:
        source = opts.bca.read_bytes()
        view = analyse(source.decode('utf-8-sig'))
        assert (view['robot'], view['api'], view['parameter']) == ('Flex', '2.18', 'ctx'), view
        assert view['status'] == 'source-only' and not view['events']
        print('BCA Flex guard OK', hashlib.sha256(source).hexdigest())
    source = fetch(f'{RAW}Protocols/develop/protocols/{SLUG}/{SLUG}.ot2.apiv2.py')
    labels = ('corning_96_wellplate_360ul_flat', 'nest_12_reservoir_15ml',
              'nest_1_reservoir_195ml', 'opentrons_96_tiprack_300ul')
    defs = {name: json.loads(fetch(f'{RAW}opentrons/v9.0.0/shared-data/labware/definitions/2/{name}/1.json'))['ordering']
            for name in labels}
    view = analyse(source.decode('utf-8-sig'), defs)
    assert view['parameter'] == 'ctx' and view['api'] == '2.13', view
    assert sorted(h['location'] for h in view['hardware'] if h['kind']=='labware') == [1,3,4,5,6,8,9,11]
    assert next(h for h in view['hardware'] if h['kind']=='instrument')['location'] is None
    assert len(view['events']) == 268, len(view['events'])
    assert view['status']=='partial'
    print('Luciferase partial trace OK', hashlib.sha256(source).hexdigest())


if __name__ == '__main__':
    main()
