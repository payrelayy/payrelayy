package com.fetanagent.telebirrverifier

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertFalse
import org.junit.Test

class RoutinePaidLaneDiagnosticTest {
  @Test
  fun `reports only the sealed outbox kind and fixed result`() {
    val assignment = RoutinePaidPendingWork.Assignment("private assignment".toByteArray())
    val upload = RoutinePaidPendingWork.Upload(
      "private assignment".toByteArray(), "private observation".toByteArray())
    assertEquals(RoutinePaidLaneDiagnostic.Outbox.EMPTY,
      RoutinePaidLaneDiagnostic.outbox(null))
    assertEquals(RoutinePaidLaneDiagnostic.Outbox.ASSIGNMENT,
      RoutinePaidLaneDiagnostic.outbox(assignment))
    assertEquals(RoutinePaidLaneDiagnostic.Outbox.UPLOAD,
      RoutinePaidLaneDiagnostic.outbox(upload))
    assertEquals("lane=2 outbox=upload result=server_rejected",
      RoutinePaidLaneDiagnostic.render(2, RoutinePaidLaneDiagnostic.Outbox.UPLOAD,
        RoutinePaidPhonePreparationResult.Review("server_rejected")))
  }

  @Test
  fun `unknown review text cannot enter a diagnostic`() {
    val diagnostic = RoutinePaidLaneDiagnostic.render(0, RoutinePaidLaneDiagnostic.Outbox.EMPTY,
      RoutinePaidPhonePreparationResult.Review("private reference and receipt"))
    assertEquals("lane=0 outbox=empty result=review_other", diagnostic)
    assertFalse(diagnostic.contains("private"))
    assertThrows(IllegalArgumentException::class.java) {
      RoutinePaidLaneDiagnostic.render(6, RoutinePaidLaneDiagnostic.Outbox.EMPTY,
        RoutinePaidPhonePreparationResult.NoAssignment)
    }
  }
}
