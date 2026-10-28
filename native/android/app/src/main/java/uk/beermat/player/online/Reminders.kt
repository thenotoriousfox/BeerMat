package uk.beermat.player.online

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.CalendarContract
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import uk.beermat.player.MainActivity
import uk.beermat.player.R

/**
 * Quiz night reminders, as the Capacitor app's: a phone notification two hours before (nothing leaves the phone), or
 * the quiz added to the phone's calendar app (no permission needed for that).
 */
object Reminders {
    private const val CHANNEL = "quiz-reminders"
    const val BEFORE_MS = 2 * 60 * 60 * 1000L

    fun canNotify(context: Context) = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Schedules the reminder; false if the quiz starts within two hours (nothing to remind). */
    fun schedule(context: Context, id: String, title: String, venue: String, startsAt: Long): Boolean {
        val at = startsAt - BEFORE_MS
        if (at <= System.currentTimeMillis()) return false
        val intent = Intent(context, ReminderReceiver::class.java).putExtra("title", title).putExtra("venue", venue).putExtra("id", id)
        val pending = PendingIntent.getBroadcast(context, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        // Inexact is fine for a two-hour heads-up, and needs no exact-alarm permission.
        context.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
        return true
    }

    fun calendarIntent(title: String, venue: String, address: String, startsAt: Long): Intent = Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI)
        .putExtra(CalendarContract.Events.TITLE, "$title — $venue")
        .putExtra(CalendarContract.Events.EVENT_LOCATION, address)
        .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, startsAt)
        .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, startsAt + 2 * 60 * 60 * 1000L)

    fun channel(context: Context) {
        context.getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CHANNEL, "Quiz night reminders", NotificationManager.IMPORTANCE_DEFAULT))
    }

    fun notify(context: Context, id: String, title: String, venue: String) {
        if (!canNotify(context)) return
        channel(context)
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.mipmap.ic_launcher_foreground)
            .setContentTitle("Quiz night in two hours").setContentText("$title at $venue").setContentIntent(open).setAutoCancel(true).build()
        context.getSystemService(NotificationManager::class.java).notify(id.hashCode(), n)
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) =
        Reminders.notify(context, intent.getStringExtra("id") ?: "", intent.getStringExtra("title") ?: "Quiz night", intent.getStringExtra("venue") ?: "")
}
