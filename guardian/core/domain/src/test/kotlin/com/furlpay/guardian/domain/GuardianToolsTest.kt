package com.furlpay.guardian.domain

import com.furlpay.guardian.domain.ai.GuardianTools
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class GuardianToolsTest {

    @Test
    fun `every voice-schema tool is present and unique`() {
        val names = GuardianTools.all.map { it.name }
        assertEquals(names.size, names.toSet().size, "tool names must be unique")
        assertTrue(names.containsAll(listOf("checkBalance", "freezeCard", "getSpending", "setReminder")))
    }

    @Test
    fun `money-mutating tools are flagged for human confirmation`() {
        // These MUST require a biometric before dispatch — matches the RN
        // co-pilot's human-in-the-loop rule.
        assertTrue("freezeCard" in GuardianTools.mutating)
        assertTrue("setReminder" in GuardianTools.mutating)
        // Read-only tools must NOT be gated (no friction on a balance check).
        assertTrue("checkBalance" !in GuardianTools.mutating)
        assertTrue("getPortfolio" !in GuardianTools.mutating)
    }

    @Test
    fun `required params are declared for the mutating tools`() {
        val freeze = assertNotNull(GuardianTools.byName("freezeCard"))
        val required = freeze.params.filter { it.required }.map { it.name }
        assertEquals(setOf("last4", "freeze"), required.toSet())
    }
}
