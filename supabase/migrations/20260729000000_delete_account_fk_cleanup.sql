-- Account deletion (Apple 5.1.1(v)) requires auth.admin.deleteUser() to succeed.
-- Four FKs to auth.users were ON DELETE NO ACTION and delete-account never
-- cleaned them, so any user with a RevenueCat event (every subscriber), a
-- marked league payment, a purchased league sub, or a created-then-archived
-- league got a hard 500 on delete — forever. Convert the four so the auth-user
-- delete resolves them cleanly:
--   subscription_events.user_id       -> CASCADE  (the user's own event history)
--   league_payments.marked_by         -> SET NULL (keep the payment row, detach)
--   league_subscriptions.purchased_by -> SET NULL (keep the sub row, detach)
--   leagues.created_by                -> SET NULL (archived leagues only; live
--                                        leagues stay blocked in-app until the
--                                        commissioner is reassigned)

ALTER TABLE public.subscription_events
  DROP CONSTRAINT subscription_events_user_id_fkey,
  ADD CONSTRAINT subscription_events_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.league_payments
  DROP CONSTRAINT league_payments_marked_by_fkey,
  ADD CONSTRAINT league_payments_marked_by_fkey
    FOREIGN KEY (marked_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.league_subscriptions
  DROP CONSTRAINT league_subscriptions_purchased_by_fkey,
  ADD CONSTRAINT league_subscriptions_purchased_by_fkey
    FOREIGN KEY (purchased_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- created_by is NOT NULL today; make it nullable so SET NULL is legal. Only a
-- deleted user's ARCHIVED league can reach NULL (live leagues block deletion),
-- and archived leagues are hidden from all clients, so a null owner is inert.
ALTER TABLE public.leagues ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.leagues
  DROP CONSTRAINT leagues_created_by_fkey,
  ADD CONSTRAINT leagues_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
