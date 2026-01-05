-- 한글 데이터 수정
SET client_encoding = 'UTF8';

UPDATE claims SET diagnosis_name = '급성충수염' WHERE diagnosis_code = 'K35.0';
UPDATE claims SET diagnosis_name = '담석증', surgery_name = '복강경 담낭절제술' WHERE diagnosis_code = 'K80.0';
UPDATE claims SET diagnosis_name = '요통' WHERE diagnosis_code = 'M54.5';
UPDATE claims SET diagnosis_name = '폐렴' WHERE diagnosis_code = 'J18.9';
