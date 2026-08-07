-- ══════════════════════════════════════════════════════════════
-- تشخيص أدق: مين المريض "Ahmad" بالضبط، وشو arzt_id المسجل على مواعيده،
-- وهل هاد الـarzt_id موجود أصلاً بجدول staff_profiles وبنفس عيادته.
-- READ-ONLY -- ما بيغيّر شي.
-- ══════════════════════════════════════════════════════════════

-- 1) بيانات Ahmad نفسه
select id, username, full_name, practice_id
from patients where full_name ilike '%ahmad%';

-- 2) مواعيده، مع arzt_id المسجل على كل موعد
select t.id, t.patient_name, t.art, t.date, t.arzt_id, t.practice_id
from termine t
where t.patient_id = (select id from patients where full_name ilike '%ahmad%' limit 1);

-- 3) هل arzt_id هاد فعليًا موجود بـstaff_profiles؟ وشو practice_id تبعو؟
--    لو النتيجة فاضية -- الـarzt_id مرجعو تالف/يتيم (مش موجود إطلاقًا).
select sp.id, sp.full_name, sp.role, sp.practice_id
from staff_profiles sp
where sp.id in (
  select t.arzt_id from termine t
  where t.patient_id = (select id from patients where full_name ilike '%ahmad%' limit 1)
);
