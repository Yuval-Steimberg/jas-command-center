P="psql -h /tmp/claude-0/pg -p 5544 -U postgres -d t -q -t -A"
ids=$($P -c "select id from cc_vol_signups where shift_id='00000000-0000-0000-0000-0000000000a1' and status='confirmed'")
for id in $ids; do $P -c "select pg_sleep(0.1); select count(*) from cc_vol_leave('$id','cancelled',null,'v',null)" >/dev/null 2>&1 & done
wait
echo "after 5 concurrent cancels:"; $P -c "select status, count(*) from cc_vol_signups where shift_id='00000000-0000-0000-0000-0000000000a1' group by 1 order by 1"
echo "promoted are the 5 earliest waitlisted:"; $P -c "with c as (select created_at from cc_vol_signups where shift_id='00000000-0000-0000-0000-0000000000a1' and status='confirmed'), w as (select created_at from cc_vol_signups where shift_id='00000000-0000-0000-0000-0000000000a1' and status='waitlisted') select (select max(created_at) from c) < (select min(created_at) from w)"
# overlap race: 10 fresh volunteers each join a1-like and a2 (overlapping, both with room) at the same moment
$P -c "insert into cc_volunteers (full_name, email) select 'R'||g, 'r'||g||'@x.com' from generate_series(1,10) g; update cc_vol_shifts set capacity=100 where id in ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2')" >/dev/null
for i in $(seq 1 10); do
  for s in a1 a2; do $P -c "select pg_sleep(0.15); select cc_vol_join('00000000-0000-0000-0000-0000000000$s', (select id from cc_volunteers where email='r$i@x.com'), 'self', 'v')" >/dev/null 2>&1 & done
done
wait
echo "fresh volunteers on both overlapping shifts (must be 0):"; $P -c "select count(*) from (select volunteer_id from cc_vol_signups s join cc_volunteers v on v.id=s.volunteer_id where v.email like 'r%' and s.status in ('confirmed','waitlisted') group by 1 having count(*)>1) x"
echo "fresh volunteers with exactly one (must be 10):"; $P -c "select count(distinct volunteer_id) from cc_vol_signups s join cc_volunteers v on v.id=s.volunteer_id where v.email like 'r%' and s.status in ('confirmed','waitlisted')"
