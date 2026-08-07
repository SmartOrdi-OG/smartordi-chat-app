-- ══════════════════════════════════════════════════════════════
-- تشخيص أعمق: كل الفحوصات السابقة (practice_id/arzt_id) كانت نظيفة، بس
-- هاي المرة عم نفحص شي ما فحصناه قبل -- هل حساب Ahmad مربوط صح بحساب
-- الدخول الحقيقي تبعو (auth.users)؟ لو الربط مكسور، هو بيقدر يسجل دخول
-- عادي (Supabase Auth بيتحقق بشكل مستقل)، بس كل استعلامات البيانات
-- (patient_get_profile/patient_get_messages/patient_get_staff_roster/...)
-- بترجع فاضية لأنها كلها بتعتمد على current_patient_id() يلي بيدور على
-- صف بجدول patients وين auth_user_id = هويته الحقيقية بجلسته -- لو ما
-- في تطابق، بترجع NULL وكل الدوال بترجع فاضي بصمت (بدون خطأ ظاهر).
-- هاد ممكن يفسر *كل* الأعراض سوا: قائمة الطبيب الفاضية، اسم/عنوان
-- العيادة "—"، وحتى الرسائل الفاضية رغم ظهور شارة "2" قديمة.
-- READ-ONLY -- ما بيغيّر شي.
-- ══════════════════════════════════════════════════════════════

-- 1) صف Ahmad بجدول patients، مع auth_user_id المسجل عندو (لو NULL،
--    هاد وحدو كافي يفسر كل شي)
select id, username, full_name, auth_user_id, practice_id
from patients where full_name ilike '%ahmad%';

-- 2) هل auth_user_id هاد فعليًا موجود بجدول auth.users؟ (لو النتيجة
--    فاضية رغم إنه العمود مو NULL بالفحص فوق -- يعني بيشاور على حساب
--    محذوف/غير موجود)
select au.id, au.email, au.created_at
from auth.users au
where au.id = (select auth_user_id from patients where full_name ilike '%ahmad%' limit 1);

-- 3) الإيميل المتوقع (المولّد تلقائيًا حسب نظام التسجيل: p_<patients.id>@
--    patients.smartordi.internal) -- هل في حساب auth.users فعلاً بهاد
--    الإيميل بالضبط؟ ولو في، هل الـid تبعو نفس auth_user_id المسجل
--    بصف Ahmad فوق؟ لو مختلفين -- هاد يعني في حسابين منفصلين وAhmad
--    عم يسجل دخول على حساب auth.users مالو صف patients خاص فيه، مش
--    صف "Ahmad Saadat" يلي شفناه بكل الفحوصات السابقة.
select
  p.id as patients_id, p.auth_user_id as linked_auth_id,
  'p_'||p.id||'@patients.smartordi.internal' as expected_email,
  au_by_email.id as auth_id_matching_expected_email,
  (p.auth_user_id = au_by_email.id) as link_is_consistent
from patients p
left join auth.users au_by_email
  on au_by_email.email = 'p_'||p.id||'@patients.smartordi.internal'
where p.full_name ilike '%ahmad%';
