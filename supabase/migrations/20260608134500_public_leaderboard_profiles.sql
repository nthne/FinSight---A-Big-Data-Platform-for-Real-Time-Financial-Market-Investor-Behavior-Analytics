CREATE OR REPLACE FUNCTION public.get_leaderboard_public_profiles()
RETURNS TABLE (
  id UUID,
  display_name TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (select auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT
    profiles.id,
    COALESCE(NULLIF(profiles.display_name, ''), 'Investor') AS display_name,
    profiles.created_at
  FROM public.profiles
  WHERE EXISTS (
    SELECT 1
    FROM public.leaderboard_entries
    WHERE leaderboard_entries.user_id = profiles.id
  )
  ORDER BY profiles.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_leaderboard_public_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_public_profiles() TO authenticated;
