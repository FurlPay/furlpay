package com.furlpay.guardian.domain

import com.furlpay.guardian.domain.ai.VoiceCommandParser
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class VoiceCommandParserTest {

    @Test
    fun `balance query without currency`() {
        val inv = VoiceCommandParser.parse("What's my balance?")!!
        assertEquals("checkBalance", inv.tool.name)
        assertTrue(inv.args.isEmpty())
    }

    @Test
    fun `balance query with currency`() {
        val inv = VoiceCommandParser.parse("How much ETH do I have?")!!
        assertEquals("checkBalance", inv.tool.name)
        assertEquals("ETH", inv.args["currency"])
    }

    @Test
    fun `freeze card extracts last4 and needs confirmation`() {
        val inv = VoiceCommandParser.parse("Freeze my card ending 4521")!!
        assertEquals("freezeCard", inv.tool.name)
        assertEquals("4521", inv.args["last4"])
        assertEquals("true", inv.args["freeze"])
        assertTrue(inv.requiresConfirmation)
    }

    @Test
    fun `unfreeze flips the flag`() {
        val inv = VoiceCommandParser.parse("unlock card 4521")!!
        assertEquals("false", inv.args["freeze"])
    }

    @Test
    fun `freeze without last4 refuses to guess`() {
        assertNull(VoiceCommandParser.parse("freeze my card"))
    }

    @Test
    fun `spending periods map to wire names`() {
        assertEquals("today", VoiceCommandParser.parse("how much did I spend today")!!.args["period"])
        assertEquals("this_week", VoiceCommandParser.parse("what's my weekly spending")!!.args["period"])
        assertEquals("this_month", VoiceCommandParser.parse("spending this month")!!.args["period"])
    }

    @Test
    fun `portfolio, travel, and next event route to read-only tools`() {
        assertEquals("getPortfolio", VoiceCommandParser.parse("how are my investments")!!.tool.name)
        assertEquals("getTravelInfo", VoiceCommandParser.parse("when is my next flight")!!.tool.name)
        assertEquals("getNextEvent", VoiceCommandParser.parse("what's my next meeting")!!.tool.name)
    }

    @Test
    fun `reminder keeps title casing and detects priority`() {
        val inv = VoiceCommandParser.parse("Critical reminder: remind me to Submit Report at 5pm")!!
        assertEquals("setReminder", inv.tool.name)
        assertEquals("Submit Report", inv.args["title"])
        assertEquals("5pm", inv.args["time"])
        assertEquals("critical", inv.args["priority"])
        assertTrue(inv.requiresConfirmation)
    }

    @Test
    fun `unparseable text returns null for LLM escalation`() {
        assertNull(VoiceCommandParser.parse("tell me a joke about crypto"))
        assertNull(VoiceCommandParser.parse(""))
    }
}
