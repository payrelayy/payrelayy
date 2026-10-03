package com.fetanagent.telebirrverifier

import android.content.SharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VerifierOperationalStateTest {
  @Test
  fun `visible observer receives service status and operator stop from another store instance`() {
    val preferences = MemoryPreferences()
    val visibleStore = VerifierOperationalStateStore(preferences)
    val serviceStore = VerifierOperationalStateStore(preferences)
    val observed = mutableListOf<VerifierOperationalSnapshot>()
    val stopObserving = visibleStore.observeChanges { observed.add(visibleStore.snapshot()) }

    serviceStore.setOperatorEnabled(true)
    serviceStore.recordStatus(
      LivePilotRuntimeStatus(LivePilotRuntimeState.ENROLLMENT_REQUIRED, "device_enrollment_rejected"),
      updatedAtMillis = 42L,
    )
    serviceStore.setOperatorEnabled(false)

    assertTrue(observed.isNotEmpty())
    assertFalse(observed.last().operatorEnabled)
    assertEquals("device_enrollment_rejected", observed.last().status.code)
    assertEquals(42L, observed.last().updatedAtMillis)
    stopObserving()
  }

  @Test
  fun `unsubscription is idempotent and suppresses an already queued callback`() {
    val preferences = MemoryPreferences()
    val store = VerifierOperationalStateStore(preferences)
    var notifications = 0
    val stopObserving = store.observeChanges { notifications += 1 }
    val queuedListeners = preferences.listeners.toList()

    stopObserving()
    stopObserving()
    store.setOperatorEnabled(true)
    queuedListeners.forEach { it.onSharedPreferenceChanged(preferences, "operator_enabled") }

    assertEquals(0, notifications)
    assertTrue(preferences.listeners.isEmpty())
  }

  @Test
  fun `unrelated preference changes do not refresh the verifier screen`() {
    val preferences = MemoryPreferences()
    val store = VerifierOperationalStateStore(preferences)
    var notifications = 0
    val stopObserving = store.observeChanges { notifications += 1 }

    preferences.edit().putString("unrelated", "synthetic").commit()
    assertEquals(0, notifications)
    store.setOperatorEnabled(true)
    assertEquals(1, notifications)
    stopObserving()
  }

  private class MemoryPreferences : SharedPreferences {
    private val values = mutableMapOf<String, Any?>()
    val listeners = mutableSetOf<SharedPreferences.OnSharedPreferenceChangeListener>()

    override fun getAll(): MutableMap<String, *> = values.toMutableMap()
    override fun getString(key: String?, defValue: String?): String? =
      values[key] as? String ?: defValue
    override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? =
      @Suppress("UNCHECKED_CAST") (values[key] as? MutableSet<String>) ?: defValues
    override fun getInt(key: String?, defValue: Int): Int = values[key] as? Int ?: defValue
    override fun getLong(key: String?, defValue: Long): Long = values[key] as? Long ?: defValue
    override fun getFloat(key: String?, defValue: Float): Float = values[key] as? Float ?: defValue
    override fun getBoolean(key: String?, defValue: Boolean): Boolean =
      values[key] as? Boolean ?: defValue
    override fun contains(key: String?): Boolean = values.containsKey(key)
    override fun registerOnSharedPreferenceChangeListener(
      listener: SharedPreferences.OnSharedPreferenceChangeListener?,
    ) { listeners.add(requireNotNull(listener)) }
    override fun unregisterOnSharedPreferenceChangeListener(
      listener: SharedPreferences.OnSharedPreferenceChangeListener?,
    ) { listeners.remove(listener) }

    override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
      private val pending = mutableMapOf<String, Any?>()
      private val removed = mutableSetOf<String>()
      private var clearRequested = false
      private fun put(key: String?, value: Any?): SharedPreferences.Editor = apply {
        pending[requireNotNull(key)] = value
      }
      override fun putString(key: String?, value: String?): SharedPreferences.Editor = put(key, value)
      override fun putStringSet(key: String?, values: MutableSet<String>?): SharedPreferences.Editor =
        put(key, values?.toMutableSet())
      override fun putInt(key: String?, value: Int): SharedPreferences.Editor = put(key, value)
      override fun putLong(key: String?, value: Long): SharedPreferences.Editor = put(key, value)
      override fun putFloat(key: String?, value: Float): SharedPreferences.Editor = put(key, value)
      override fun putBoolean(key: String?, value: Boolean): SharedPreferences.Editor = put(key, value)
      override fun remove(key: String?): SharedPreferences.Editor = apply {
        removed.add(requireNotNull(key))
      }
      override fun clear(): SharedPreferences.Editor = apply { clearRequested = true }
      override fun commit(): Boolean {
        val changed = (if (clearRequested) values.keys else emptySet()) + removed + pending.keys
        if (clearRequested) values.clear()
        removed.forEach(values::remove)
        values.putAll(pending)
        val callbacks = listeners.toList()
        changed.forEach { key ->
          callbacks.forEach { it.onSharedPreferenceChanged(this@MemoryPreferences, key) }
        }
        return true
      }
      override fun apply() { commit() }
    }
  }
}
