-- ══════════════════════════════════════════════════════════════
-- تشخيص: "Termin buchen" Arzt-dropdown فاضي ("Keine Optionen") لمريض حقيقي
-- READ-ONLY -- ما بيغيّر شي، بس بيوري وين المشكلة بالضبط.
--
-- استبدلي 'PATIENT_USERNAME_HIER' بـusername المريض (Alina مثلاً).
-- ══════════════════════════════════════════════════════════════

-- 1) هاد المريض تبع أي practice_id؟
select id, username, full_name, practice_id from patients where username = 'PATIENT_USERNAME_HIER';

-- 2) شو الأطباء (role='arzt') الموجودين بنفس الـpractice_id؟ لازم يطلع صف واحد ع الأقل.
select sp.id, sp.full_name, sp.role, sp.is_admin, sp.practice_id
from staff_profiles sp
where sp.practice_id = (select practice_id from patients where username = 'PATIENT_USERNAME_HIER');

-- 3) لو النتيجة فاضية فوق، هاد بيوري كل الأطباء وعياداتهم -- قارني practice_id
--    تبع المريض (من فحص ١) مع practice_id تبع الطبيب يلي المفروض يعالجه.
select id, full_name, role, is_admin, practice_id from staff_profiles where role = 'arzt';
