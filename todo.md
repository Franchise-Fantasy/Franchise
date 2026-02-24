- Game data: date and opponent.

- Player data: pictures

- Tooltips for fields in league creation/or a key to explain things.

- one person didn't get "draft is over" message

- roster flashing enpty when dropping a player

- venmo in league info

3. Private League Invites — Private leagues exist but there's no invite link or join code mechanism. The only way to join is browsing public leagues. This blocks real-world usage since most leagues are friend groups.

4. Push Notifications (beyond draft) — You have the token infrastructure but only fire for draft alerts. No notifications for trade proposals, matchup results, waiver claims, or commissioner announcements. Without these, users forget the app exists between sessions.

5. League Chat — Your home screen already has the placeholder button. League engagement lives and dies by trash talk and trade negotiation.

6. Commissioner Admin Tools — Can't force-add/drop, reverse trades, lock inactive teams, or manually adjust the schedule. Commissioners will need these for dispute resolution.

7. Season Rollover / Rookie Draft — You have the drafts.type = 'rookie' column and future draft picks in the DB, but no flow to actually end a season and start the next one.
