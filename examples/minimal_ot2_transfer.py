from opentrons import protocol_api

metadata = {
    "protocolName": "LifeFabs inspection example",
    "author": "LifeFabs educational template",
    "description": "One explicit transfer for static inspection; validate in the Opentrons App before use.",
}

requirements = {"robotType": "OT-2", "apiLevel": "2.15"}


def run(protocol: protocol_api.ProtocolContext):
    source_plate = protocol.load_labware("nest_96_wellplate_200ul_flat", "1")
    destination_plate = protocol.load_labware(
        "opentrons_96_wellplate_200ul_pcr_full_skirt", "2"
    )
    tip_rack = protocol.load_labware("opentrons_96_tiprack_300ul", "3")
    pipette = protocol.load_instrument(
        "p300_single_gen2", mount="right", tip_racks=[tip_rack]
    )

    pipette.pick_up_tip(tip_rack["A1"])
    pipette.aspirate(50, source_plate["A1"].bottom(z=1))
    pipette.dispense(50, destination_plate["A1"].bottom(z=1))
    pipette.drop_tip()
