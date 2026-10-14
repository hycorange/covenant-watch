// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {CovenantRegistry} from "../src/CovenantRegistry.sol";
import {TokenizedNote, ICovenantRegistry} from "../src/TokenizedNote.sol";
import {ReceiverTemplate} from "../src/ReceiverTemplate.sol";

contract CovenantRegistryTest is Test {
    address forwarder = address(0xF0);
    address alice = address(0xA1);
    address bob = address(0xB0);
    uint64 constant CIK = 1234567;
    CovenantRegistry reg;
    TokenizedNote note;

    function setUp() public {
        reg = new CovenantRegistry(forwarder);
        note = new TokenizedNote("Acme 7% 2030 Note", CIK, ICovenantRegistry(address(reg)), 1000e18);
        note.transfer(alice, 100e18);
    }

    function _report(string memory acc, uint32 date, uint32 mask, uint8 sev) internal pure returns (bytes memory) {
        return abi.encode(CIK, keccak256(bytes(acc)), date, mask, sev, acc);
    }

    function _send(bytes memory report) internal {
        vm.prank(forwarder);
        reg.onReport("", report);
    }

    function test_breachHaltsNoteTransfers() public {
        _send(_report("0001234567-26-000042", 20261013, uint32(1 << 8), 3)); // 2.04
        assertTrue(reg.isBreached(CIK));
        assertTrue(note.transfersHalted());
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TokenizedNote.TransfersHalted.selector, CIK));
        note.transfer(bob, 1e18);
    }

    function test_watchRecordsButDoesNotHalt() public {
        _send(_report("0001234567-26-000003", 20261010, uint32(1 << 16), 2)); // 5.01
        assertFalse(reg.isBreached(CIK));
        assertEq(reg.eventCount(CIK), 1);
        (, uint32 date,, uint8 sev,) = reg.lastEvent(CIK);
        assertEq(date, 20261010);
        assertEq(sev, 2);
        vm.prank(alice);
        note.transfer(bob, 1e18);
        assertEq(note.balanceOf(bob), 1e18);
    }

    function test_duplicateIsIgnoredAndDoesNotReflagAfterCure() public {
        bytes memory r = _report("0001234567-26-000042", 20261013, uint32(1 << 2), 3); // 1.03
        _send(r);
        reg.cure(CIK, "court-approved waiver");
        assertFalse(reg.isBreached(CIK));
        _send(r); // DON retry / overlapping tick
        assertFalse(reg.isBreached(CIK));
        assertEq(reg.eventCount(CIK), 1);
        _send(_report("0001234567-26-000060", 20261020, uint32(1 << 15), 3)); // new 4.02 re-flags
        assertTrue(reg.isBreached(CIK));
    }

    function test_onlyForwarderCanReport() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidSender.selector, alice, forwarder));
        reg.onReport("", _report("x", 20261013, 4, 3));
    }

    function test_onlyOwnerCanCure() public {
        vm.prank(alice);
        vm.expectRevert();
        reg.cure(CIK, "nope");
    }

    function test_rejectsBadSeverity() public {
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(CovenantRegistry.BadSeverity.selector, uint8(4)));
        reg.onReport("", _report("x", 20261013, 4, 4));
    }

    function test_olderFilingDoesNotOverwriteLastEvent() public {
        _send(_report("new", 20261013, 4, 3));
        _send(_report("old", 20261001, uint32(1 << 16), 2));
        (bytes32 h,,,,) = reg.lastEvent(CIK);
        assertEq(h, keccak256("new"));
        assertEq(reg.eventCount(CIK), 2);
    }
}
