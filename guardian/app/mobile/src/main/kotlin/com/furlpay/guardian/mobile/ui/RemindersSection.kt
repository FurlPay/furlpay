package com.furlpay.guardian.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.furlpay.guardian.domain.model.EventPriority
import com.furlpay.guardian.domain.model.GuardianEvent
import kotlin.time.Duration
import kotlin.time.Duration.Companion.hours
import kotlin.time.Duration.Companion.minutes
import kotlinx.datetime.Clock

// ---------------------------------------------------------------------------
// Life Guardian reminders on the phone dashboard: the feed (priority-ordered
// by the tested rule) + a creation dialog. Priority colors mirror the watch
// bible: CRITICAL red, HIGH amber, MEDIUM blue, LOW dim.
// ---------------------------------------------------------------------------

private val PRESETS: List<Pair<String, Duration>> = listOf(
    "15 min" to 15.minutes,
    "1 hour" to 1.hours,
    "3 hours" to 3.hours,
    "Tomorrow" to 24.hours,
)

@Composable
fun priorityColor(priority: EventPriority): Color = when (priority) {
    EventPriority.CRITICAL -> MaterialTheme.colorScheme.error
    EventPriority.HIGH -> Color(0xFFFFB77C)
    EventPriority.MEDIUM -> MaterialTheme.colorScheme.primary
    EventPriority.LOW -> MaterialTheme.colorScheme.onSurfaceVariant
}

@Composable
fun ReminderRow(event: GuardianEvent, onAcknowledge: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(event.title, style = MaterialTheme.typography.bodyMedium)
                Text(
                    text = event.priority.name.lowercase() + (event.startAt?.let { start ->
                        val minutes = (start - Clock.System.now()).inWholeMinutes
                        when {
                            minutes < 0 -> " · overdue"
                            minutes < 60 -> " · in ${minutes}m"
                            minutes < 24 * 60 -> " · in ${minutes / 60}h ${minutes % 60}m"
                            else -> " · in ${minutes / (24 * 60)}d"
                        }
                    } ?: ""),
                    style = MaterialTheme.typography.bodySmall,
                    color = priorityColor(event.priority),
                )
            }
            TextButton(onClick = onAcknowledge) { Text("Done") }
        }
    }
}

@Composable
fun NewReminderDialog(
    creating: Boolean,
    onCreate: (title: String, inFromNow: Duration, priority: EventPriority) -> Unit,
    onDismiss: () -> Unit,
) {
    var title by remember { mutableStateOf("") }
    var presetIndex by remember { mutableStateOf(0) }
    var priority by remember { mutableStateOf(EventPriority.MEDIUM) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New reminder") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("What?") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("When", style = MaterialTheme.typography.labelMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PRESETS.forEachIndexed { index, (label, _) ->
                        FilterChip(
                            selected = presetIndex == index,
                            onClick = { presetIndex = index },
                            label = { Text(label) },
                        )
                    }
                }
                Text("Priority", style = MaterialTheme.typography.labelMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    EventPriority.entries.forEach { option ->
                        FilterChip(
                            selected = priority == option,
                            onClick = { priority = option },
                            label = { Text(option.name.lowercase()) },
                        )
                    }
                }
                if (priority == EventPriority.CRITICAL) {
                    Text(
                        "Critical reminders escalate on phone AND watch — " +
                            "louder every stage, through Do Not Disturb, until you acknowledge.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onCreate(title, PRESETS[presetIndex].second, priority) },
                enabled = !creating && title.isNotBlank(),
            ) { Text(if (creating) "Creating…" else "Create") }
        },
        dismissButton = {
            OutlinedButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}
