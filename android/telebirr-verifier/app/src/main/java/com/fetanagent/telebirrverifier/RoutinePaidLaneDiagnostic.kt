package com.fetanagent.telebirrverifier

/** Fixed, non-sensitive operational categories. Never render sealed work or server bodies. */
internal object RoutinePaidLaneDiagnostic {
  enum class Outbox { EMPTY, ASSIGNMENT, UPLOAD, UNAVAILABLE }

  fun outbox(pending: RoutinePaidPendingWork?): Outbox = when (pending) {
    null -> Outbox.EMPTY
    is RoutinePaidPendingWork.Assignment -> Outbox.ASSIGNMENT
    is RoutinePaidPendingWork.Upload -> Outbox.UPLOAD
  }

  fun render(lane: Int, outbox: Outbox, result: RoutinePaidPhonePreparationResult): String {
    require(lane in 0 until RoutinePaidParallelCycle.MAX_LANES)
    val resultCode = when (result) {
      RoutinePaidPhonePreparationResult.NoAssignment -> "no_assignment"
      RoutinePaidPhonePreparationResult.Retry -> "retry"
      RoutinePaidPhonePreparationResult.SubmittedForReview -> "observation_staged"
      is RoutinePaidPhonePreparationResult.Review -> when (result.reasonCode) {
        "server_rejected", "lookup_expired", "local_work_unavailable",
        "terminal_upload_archived",
        "enrollment_unavailable", "device_key_unavailable", "clock_unavailable",
        "invalid_assignment_response", "invalid_upload_response", "upload_rejected",
        "observation_conflict", "observation_invalid", "transport_unavailable",
        "receipt_review", "invalid_assignment", "paid_slot_unavailable" -> result.reasonCode
        else -> "review_other"
      }
    }
    return "lane=$lane outbox=${outbox.name.lowercase()} result=$resultCode"
  }
}
