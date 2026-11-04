#!/bin/sh
# Races for 0011, after tests/sql/schedule.sql has run on the same database.
# Each line printed must match the expectation next to it.
P="psql -h ${PGHOST:-/tmp/claude-0/pg} -p ${PGPORT:-5544} -U postgres -d ${PGDB:-t} -qtA"
SETUP="select set_config('request.jwt.claims', '{\"sub\":\"11111111-1111-4111-8111-111111111111\",\"role\":\"authenticated\"}', false); set role authenticated;"
D=$($P -c "select cc_vol__today() + 28 + ((2 - extract(dow from cc_vol__today())::int + 7) % 7)")
TUE=$($P -c "select id from cc_vol_slots where weekday = 2")

# 1. Eight simultaneous "assign Ruti on D" (a double-tapped button, two tabs): one live row.
for i in 1 2 3 4 5 6 7 8; do
  $P -c "$SETUP select count(*) from cc_vol_sched_assign('$TUE', 'b0000000-0000-4000-8000-000000000002', '$D', 'confirmed', null, null);" >/dev/null 2>&1 &
done
wait
echo "live assignments for Ruti on $D (expect 1): $($P -c "select count(*) from cc_vol_assignments where volunteer_id = 'b0000000-0000-4000-8000-000000000002' and on_date = '$D' and cancelled_at is null")"

# 2. Yossi reports he will not come WHILE Dafna assigns him as an extra on the same date is impossible
#    (he is a regular); instead race: Yossi's absence vs Dafna replacing Yossi with Avi. Exactly one absence, Avi assigned once.
$P -c "select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false); set role service_role; select count(*) from cc_vol_sched_absence('$TUE', 'b0000000-0000-4000-8000-000000000001', '$D', null, 'volunteer');" >/dev/null 2>&1 &
$P -c "$SETUP select count(*) from cc_vol_sched_replace('$TUE', '$D', 'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', 'confirmed', null);" >/dev/null 2>&1 &
$P -c "$SETUP select count(*) from cc_vol_sched_replace('$TUE', '$D', 'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', 'confirmed', null);" >/dev/null 2>&1 &
wait
echo "live absences for Yossi on $D (expect 1): $($P -c "select count(*) from cc_vol_absences where volunteer_id = 'b0000000-0000-4000-8000-000000000001' and on_date = '$D' and withdrawn_at is null")"
echo "live assignments for Avi on $D (expect 1): $($P -c "select count(*) from cc_vol_assignments where volunteer_id = 'b0000000-0000-4000-8000-000000000003' and on_date = '$D' and cancelled_at is null")"
