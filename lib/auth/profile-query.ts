/**
 * The profile + roles read used at sign-in. cc_user_roles references
 * cc_profiles TWICE (profile_id = whose role it is, granted_by = who granted
 * it), so a bare `cc_user_roles(role)` embed is ambiguous and PostgREST refuses
 * the whole query (PGRST201). The `!profile_id` hint names the relationship.
 */
export const PROFILE_WITH_ROLES = 'id, email, full_name, is_active, cc_user_roles!profile_id(role)'
