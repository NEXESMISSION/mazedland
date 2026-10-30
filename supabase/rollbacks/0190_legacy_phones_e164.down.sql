-- Rollback of 0190: the two admin profiles go back to their bare national
-- number. By id and by their current value, so nothing else can be touched.
select set_config('app.bypass_profile_guard', 'on', true);

update public.profiles set phone = '58415500'
 where id = 'af68a9f6-4ea7-4895-9b11-e4379a7a7e50' and phone = '+21658415500';
update public.profiles set phone = '53518337'
 where id = 'ec004394-1ac5-4473-9312-b9252b3e8b19' and phone = '+21653518337';

select set_config('app.bypass_profile_guard', 'off', true);

notify pgrst, 'reload schema';
