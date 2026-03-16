export { process as processGmail } from "@/lib/processors/gmail";
export { process as processCalendar } from "@/lib/processors/calendar";
export { process as processWhisper } from "@/lib/processors/whisper";
export { process as processLinear } from "@/lib/processors/linear";
export { process as processReminder } from "@/lib/processors/reminder";

export type { GmailPayload, ProcessedGmail } from "@/lib/processors/gmail";
export type { CalendarPayload, ProcessedCalendar } from "@/lib/processors/calendar";
export type { WhisperPayload, ProcessedWhisper } from "@/lib/processors/whisper";
export type { LinearPayload, ProcessedLinear } from "@/lib/processors/linear";
export type { ReminderPayload, ProcessedReminder } from "@/lib/processors/reminder";
