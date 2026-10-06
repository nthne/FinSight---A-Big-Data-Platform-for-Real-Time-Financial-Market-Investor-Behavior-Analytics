GRANT SELECT, INSERT, UPDATE ON public.leaderboard_entries TO authenticated;

DROP POLICY IF EXISTS "own leaderboard entries insert" ON public.leaderboard_entries;
CREATE POLICY "own leaderboard entries insert"
ON public.leaderboard_entries
FOR INSERT
TO authenticated
WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "own leaderboard entries update" ON public.leaderboard_entries;
CREATE POLICY "own leaderboard entries update"
ON public.leaderboard_entries
FOR UPDATE
TO authenticated
USING ((select auth.uid()) = user_id)
WITH CHECK ((select auth.uid()) = user_id);
