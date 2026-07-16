package com.furlpay.guardian.domain.ai

import com.furlpay.guardian.domain.GuardianResult

/** What a tool run says back — the text the watch shows/speaks, plus a domain
 *  hint ("wallet", "card", "event", "travel", "error") for the response icon. */
data class ToolReply(val text: String, val kind: String = "generic")

/**
 * Executes catalog tools. Implemented in the app layer (it owns repositories
 * and the biometric gate). CONTRACT: implementations MUST refuse mutating
 * tools unless the human has confirmed — [ToolInvocation.requiresConfirmation]
 * marks them; "the model asked" is never authorization.
 */
interface GuardianToolExecutor {
    suspend fun execute(invocation: ToolInvocation): GuardianResult<ToolReply>
}
