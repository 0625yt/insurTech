-- Mock data seeds (idempotent)
-- Base seed data is inserted only when claims are empty.
-- Extra policy_coverages are ensured for enterprise mock inserts.

DO $$
BEGIN
        INSERT INTO coverage_types (
            code, name, category, calculation_type, default_payout_rate, default_deductible, description
        ) VALUES
        ('REAL_LOSS_HOSP_INS', 'Inpatient Medical (Insured)', 'REAL_LOSS', 'PERCENTAGE', 90, 100000, 'Inpatient insured medical'),
        ('REAL_LOSS_HOSP_UNINS', 'Inpatient Medical (Uninsured)', 'REAL_LOSS', 'PERCENTAGE', 80, 200000, 'Inpatient uninsured medical'),
        ('REAL_LOSS_OUT_INS', 'Outpatient Medical (Insured)', 'REAL_LOSS', 'PERCENTAGE', 90, 10000, 'Outpatient insured medical'),
        ('REAL_LOSS_OUT_UNINS', 'Outpatient Medical (Uninsured)', 'REAL_LOSS', 'PERCENTAGE', 80, 30000, 'Outpatient uninsured medical'),
        ('FIXED_HOSP_DAILY', 'Hospital Daily Allowance', 'FIXED', 'DAILY', 100, 0, 'Daily inpatient allowance'),
        ('FIXED_SURGERY_1', 'Surgery Class 1', 'FIXED', 'LUMP_SUM', 100, 0, 'Surgery class 1'),
        ('FIXED_SURGERY_2', 'Surgery Class 2', 'FIXED', 'LUMP_SUM', 100, 0, 'Surgery class 2'),
        ('FIXED_SURGERY_3', 'Surgery Class 3', 'FIXED', 'LUMP_SUM', 100, 0, 'Surgery class 3'),
        ('FIXED_SURGERY_4', 'Surgery Class 4', 'FIXED', 'LUMP_SUM', 100, 0, 'Surgery class 4'),
        ('FIXED_SURGERY_5', 'Surgery Class 5', 'FIXED', 'LUMP_SUM', 100, 0, 'Surgery class 5'),
        ('FIXED_DIAGNOSIS', 'Diagnosis Benefit', 'FIXED', 'LUMP_SUM', 100, 0, 'Diagnosis lump sum'),
        ('FIXED_CANCER', 'Cancer Diagnosis Benefit', 'FIXED', 'LUMP_SUM', 100, 0, 'Cancer diagnosis lump sum'),
        ('FIXED_CI', 'Critical Illness Benefit', 'FIXED', 'LUMP_SUM', 100, 0, 'Critical illness lump sum')
        ON CONFLICT (code) DO NOTHING;

        INSERT INTO diagnosis_codes (
            code, name, category, chapter, is_critical_illness, is_cancer,
            default_treatment_days, fraud_risk_base, requires_surgery, chronic_disease
        ) VALUES
        ('K35.0', 'Acute appendicitis', 'DISEASE', 'Digestive', FALSE, FALSE, 7, 0.10, TRUE, FALSE),
        ('K80.0', 'Cholelithiasis', 'DISEASE', 'Digestive', FALSE, FALSE, 10, 0.12, TRUE, FALSE),
        ('J18.9', 'Pneumonia', 'DISEASE', 'Respiratory', FALSE, FALSE, 5, 0.08, FALSE, FALSE),
        ('M54.5', 'Low back pain', 'DISEASE', 'Musculoskeletal', FALSE, FALSE, 7, 0.20, FALSE, TRUE),
        ('I21.9', 'Acute myocardial infarction', 'DISEASE', 'Circulatory', TRUE, FALSE, 14, 0.15, TRUE, TRUE),
        ('H25.1', 'Senile cataract', 'DISEASE', 'Eye', FALSE, FALSE, 3, 0.05, TRUE, FALSE),
        ('S82.0', 'Patella fracture', 'INJURY', 'Injury', FALSE, FALSE, 21, 0.18, TRUE, FALSE)
        ON CONFLICT (code) DO NOTHING;

        INSERT INTO surgery_classification (
            code, name, classification, category, related_diagnosis_codes, average_cost, average_hospital_days
        ) VALUES
        ('S0401', 'Appendectomy (laparoscopic)', 2, 'General', ARRAY['K35.0'], 600000, 4),
        ('S0501', 'Cholecystectomy (laparoscopic)', 2, 'General', ARRAY['K80.0'], 1000000, 3),
        ('S0802', 'PCI', 4, 'Cardiology', ARRAY['I21.9'], 3000000, 7),
        ('S1101', 'Cataract surgery', 1, 'Ophthalmology', ARRAY['H25.1'], 1500000, 1),
        ('S0902', 'Knee arthroplasty', 4, 'Orthopedics', ARRAY['S82.0'], 4000000, 6)
        ON CONFLICT (code) DO NOTHING;

        INSERT INTO fraud_patterns (
            pattern_code, pattern_name, description, detection_rule, risk_weight, action_required
        ) VALUES
        ('FRD001', 'Multiple claims in short period', 'Short-term multiple claims', '{}'::jsonb, 0.30, 'MANUAL_REVIEW'),
        ('FRD002', 'Repeated back pain claims', 'Repeated back pain claims', '{}'::jsonb, 0.40, 'INVESTIGATE'),
        ('FRD003', 'Weekend admission pattern', 'Weekend admission pattern', '{}'::jsonb, 0.25, 'REVIEW'),
        ('FRD004', 'Single high amount claim', 'High amount single claim', '{}'::jsonb, 0.20, 'REVIEW'),
        ('FRD005', 'Early claim after policy', 'Claim within 12 months', '{}'::jsonb, 0.25, 'REVIEW')
        ON CONFLICT (pattern_code) DO NOTHING;

        INSERT INTO customers (
            customer_code, name, birth_date, gender, phone, email, risk_grade, risk_score
        ) VALUES
        ('CUST-0001', 'Gil-dong Hong', '1990-01-15', 'M', '010-1234-5678', 'hong@example.com', 'NORMAL', 0.10),
        ('CUST-0002', 'Cheol-su Kim', '1985-03-20', 'M', '010-9876-5432', 'kim@example.com', 'NORMAL', 0.08),
        ('CUST-0003', 'Young-hee Lee', '1992-07-08', 'F', '010-5555-6666', 'lee@example.com', 'NORMAL', 0.15),
        ('CUST-0004', 'Min-su Park', '1988-11-02', 'M', '010-2222-3333', 'park@example.com', 'WATCH', 0.68),
        ('CUST-0005', 'Su-jin Jung', '1979-05-14', 'F', '010-7777-8888', 'jung@example.com', 'NORMAL', 0.05),
        ('CUST-0006', 'Young-mi Han', '1968-09-21', 'F', '010-1111-2222', 'han@example.com', 'NORMAL', 0.12),
        ('CUST-0007', 'Tae-ho Choi', '1996-12-03', 'M', '010-3333-4444', 'choi@example.com', 'NORMAL', 0.07)
        ON CONFLICT (customer_code) DO NOTHING;

        INSERT INTO policies (
            policy_number, customer_id, product_name, product_code, status, contract_date,
            coverage_start_date, coverage_end_date, premium_amount, premium_status,
            exemption_end_date, reduction_end_date, reduction_rate
        ) VALUES
        ('POL-2024-001', (SELECT id FROM customers WHERE customer_code = 'CUST-0001'), 'Medical Comprehensive', 'PRD001', 'ACTIVE', '2023-01-15',
         '2023-01-15', '2043-01-14', 85000, 'PAID', '2023-04-15', '2024-01-15', 50),
        ('POL-2024-002', (SELECT id FROM customers WHERE customer_code = 'CUST-0002'), 'Medical Comprehensive', 'PRD001', 'ACTIVE', '2023-06-01',
         '2023-06-01', '2043-05-31', 92000, 'PAID', '2023-09-01', '2024-06-01', 50),
        ('POL-2024-003', (SELECT id FROM customers WHERE customer_code = 'CUST-0003'), 'Medical Plus', 'PRD002', 'ACTIVE', '2024-01-10',
         '2024-01-10', '2044-01-09', 65000, 'PAID', '2024-04-10', '2025-01-10', 50),
        ('POL-2024-004', (SELECT id FROM customers WHERE customer_code = 'CUST-0004'), 'Medical Comprehensive', 'PRD001', 'ACTIVE', '2022-03-20',
         '2022-03-20', '2042-03-19', 78000, 'OVERDUE', '2022-06-20', '2023-03-20', 50),
        ('POL-2024-005', (SELECT id FROM customers WHERE customer_code = 'CUST-0005'), 'Medical Comprehensive', 'PRD001', 'ACTIVE', '2023-09-05',
         '2023-09-05', '2043-09-04', 88000, 'PAID', '2023-12-05', '2024-09-05', 50),
        ('POL-2024-006', (SELECT id FROM customers WHERE customer_code = 'CUST-0006'), 'Cataract Plan', 'PRD003', 'ACTIVE', '2021-05-01',
         '2021-05-01', '2041-04-30', 120000, 'PAID', '2021-08-01', '2022-05-01', 50),
        ('POL-2024-007', (SELECT id FROM customers WHERE customer_code = 'CUST-0007'), 'Medical Comprehensive', 'PRD001', 'ACTIVE', '2024-06-01',
         '2024-06-01', '2044-05-31', 75000, 'PAID', '2024-09-01', '2025-06-01', 50)
        ON CONFLICT (policy_number) DO NOTHING;

        -- policy_coverages with fixed IDs to align with claim_items mock
        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 1, (SELECT id FROM policies WHERE policy_number = 'POL-2024-001'),
               (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_HOSP_INS'),
               'Inpatient Insured', 'DIS_HOSP_INS', 30000000, 'MAX', 100000, 10, 90, NULL, 30000000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 1);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 2, (SELECT id FROM policies WHERE policy_number = 'POL-2024-001'),
               (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_HOSP_UNINS'),
               'Inpatient Uninsured', 'DIS_HOSP_UNINS', 30000000, 'MAX', 200000, 0, 80, NULL, 30000000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 2);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 3, (SELECT id FROM policies WHERE policy_number = 'POL-2024-001'),
               (SELECT id FROM coverage_types WHERE code = 'FIXED_HOSP_DAILY'),
               'Hospital Daily', 'DIS_HOSP_DAILY', 50000, 'FIXED', 0, 0, 100, 30, 1500000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 3);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 4, (SELECT id FROM policies WHERE policy_number = 'POL-2024-001'),
               (SELECT id FROM coverage_types WHERE code = 'FIXED_SURGERY_1'),
               'Surgery Class 1', 'DIS_SURG_1', 300000, 'FIXED', 0, 0, 100, NULL, 3000000, 0, 1
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 4);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 5, (SELECT id FROM policies WHERE policy_number = 'POL-2024-001'),
               (SELECT id FROM coverage_types WHERE code = 'FIXED_SURGERY_2'),
               'Surgery Class 2', 'DIS_SURG_2', 600000, 'FIXED', 0, 0, 100, NULL, 3000000, 0, 2
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 5);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 6, (SELECT id FROM policies WHERE policy_number = 'POL-2024-002'),
               (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_HOSP_INS'),
               'Inpatient Insured', 'DIS_HOSP_INS', 30000000, 'MAX', 100000, 10, 90, NULL, 30000000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 6);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 7, (SELECT id FROM policies WHERE policy_number = 'POL-2024-002'),
               (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_HOSP_UNINS'),
               'Inpatient Uninsured', 'DIS_HOSP_UNINS', 30000000, 'MAX', 200000, 0, 80, NULL, 30000000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 7);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 8, (SELECT id FROM policies WHERE policy_number = 'POL-2024-002'),
               (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_OUT_INS'),
               'Outpatient Insured', 'OUT_INS', 200000, 'FIXED', 10000, 0, 90, NULL, 2400000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 8);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 9, (SELECT id FROM policies WHERE policy_number = 'POL-2024-002'),
               (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_HOSP_INS'),
               'Inpatient Insured', 'DIS_HOSP_INS', 30000000, 'MAX', 100000, 10, 90, NULL, 30000000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 9);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 10, (SELECT id FROM policies WHERE policy_number = 'POL-2024-002'),
               (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_HOSP_UNINS'),
               'Inpatient Uninsured', 'DIS_HOSP_UNINS', 30000000, 'MAX', 200000, 0, 80, NULL, 30000000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 10);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 11, (SELECT id FROM policies WHERE policy_number = 'POL-2024-002'),
               (SELECT id FROM coverage_types WHERE code = 'FIXED_HOSP_DAILY'),
               'Hospital Daily', 'DIS_HOSP_DAILY', 100000, 'FIXED', 0, 0, 100, 30, 3000000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 11);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 12, (SELECT id FROM policies WHERE policy_number = 'POL-2024-002'),
               (SELECT id FROM coverage_types WHERE code = 'FIXED_SURGERY_1'),
               'Surgery Class 1', 'DIS_SURG_1', 500000, 'FIXED', 0, 0, 100, NULL, 5000000, 0, 1
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 12);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 13, (SELECT id FROM policies WHERE policy_number = 'POL-2024-002'),
               (SELECT id FROM coverage_types WHERE code = 'FIXED_SURGERY_2'),
               'Surgery Class 2', 'DIS_SURG_2', 1000000, 'FIXED', 0, 0, 100, NULL, 5000000, 0, 2
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 13);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 14, (SELECT id FROM policies WHERE policy_number = 'POL-2024-003'),
               (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_HOSP_INS'),
               'Inpatient Insured', 'DIS_HOSP_INS', 30000000, 'MAX', 100000, 10, 90, NULL, 30000000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 14);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 15, (SELECT id FROM policies WHERE policy_number = 'POL-2024-003'),
               (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_OUT_INS'),
               'Outpatient Insured', 'OUT_INS', 200000, 'FIXED', 10000, 0, 90, NULL, 2400000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 15);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 16, (SELECT id FROM policies WHERE policy_number = 'POL-2024-003'),
               (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_OUT_UNINS'),
               'Outpatient Uninsured', 'OUT_UNINS', 200000, 'FIXED', 30000, 0, 80, NULL, 2400000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 16);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 17, (SELECT id FROM policies WHERE policy_number = 'POL-2024-003'),
               (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_OUT_INS'),
               'Outpatient Insured', 'OUT_INS', 200000, 'FIXED', 10000, 0, 90, NULL, 2400000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 17);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 18, (SELECT id FROM policies WHERE policy_number = 'POL-2024-003'),
               (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_OUT_INS'),
               'Outpatient Insured', 'OUT_INS', 200000, 'FIXED', 10000, 0, 90, NULL, 2400000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 18);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 19, (SELECT id FROM policies WHERE policy_number = 'POL-2024-003'),
               (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_OUT_UNINS'),
               'Outpatient Uninsured', 'OUT_UNINS', 200000, 'FIXED', 30000, 0, 80, NULL, 2400000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 19);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 20, (SELECT id FROM policies WHERE policy_number = 'POL-2024-004'),
               (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_HOSP_INS'),
               'Inpatient Insured', 'DIS_HOSP_INS', 30000000, 'MAX', 100000, 10, 90, NULL, 30000000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 20);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 21, (SELECT id FROM policies WHERE policy_number = 'POL-2024-005'),
               (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_HOSP_INS'),
               'Inpatient Insured', 'DIS_HOSP_INS', 50000000, 'MAX', 100000, 10, 90, NULL, 50000000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 21);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 22, (SELECT id FROM policies WHERE policy_number = 'POL-2024-005'),
               (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_HOSP_UNINS'),
               'Inpatient Uninsured', 'DIS_HOSP_UNINS', 50000000, 'MAX', 200000, 0, 80, NULL, 50000000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 22);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 23, (SELECT id FROM policies WHERE policy_number = 'POL-2024-005'),
               (SELECT id FROM coverage_types WHERE code = 'FIXED_HOSP_DAILY'),
               'Hospital Daily', 'DIS_HOSP_DAILY', 100000, 'FIXED', 0, 0, 100, 30, 7000000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 23);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 24, (SELECT id FROM policies WHERE policy_number = 'POL-2024-005'),
               (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_OUT_INS'),
               'Outpatient Insured', 'OUT_INS', 200000, 'FIXED', 10000, 0, 90, NULL, 2400000, 0, NULL
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 24);

        INSERT INTO policy_coverages (
            id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
            deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
            annual_limit, used_annual_amount, surgery_classification
        )
        SELECT 25, (SELECT id FROM policies WHERE policy_number = 'POL-2024-005'),
               (SELECT id FROM coverage_types WHERE code = 'FIXED_SURGERY_4'),
               'Surgery Class 4', 'DIS_SURG_4', 3000000, 'FIXED', 0, 0, 100, NULL, 30000000, 0, 4
        WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 25);

        INSERT INTO claims (
            claim_number, policy_id, customer_id, claim_type, claim_subtype,
            treatment_start_date, treatment_end_date, hospital_name, hospital_type,
            diagnosis_code, diagnosis_name, surgery_code, surgery_name, surgery_classification,
            hospitalization_days, total_medical_expense, insured_expense, uninsured_expense,
            total_claimed_amount, status
        ) VALUES
        ('CLM-2024-00001', (SELECT id FROM policies WHERE policy_number = 'POL-2024-001'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0001'),
         'HOSPITALIZATION', 'DISEASE', '2024-12-10', '2024-12-14', 'Seoul University Hospital', 'GENERAL',
         'K35.0', 'Acute appendicitis', 'S0401', 'Appendectomy', 2, 4, 1520000, 1200000, 320000, 1520000, 'RECEIVED'),
        ('CLM-2024-00002', (SELECT id FROM policies WHERE policy_number = 'POL-2024-002'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0002'),
         'SURGERY', 'DISEASE', '2024-12-12', '2024-12-15', 'Samsung Medical Center', 'GENERAL',
         'K80.0', 'Cholelithiasis', 'S0501', 'Cholecystectomy', 2, 3, 3500000, 2800000, 700000, 3500000, 'RECEIVED'),
        ('CLM-2024-00003', (SELECT id FROM policies WHERE policy_number = 'POL-2024-003'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0003'),
         'OUTPATIENT', 'DISEASE', '2024-12-15', '2024-12-15', 'Gangnam Severance Hospital', 'GENERAL',
         'J18.9', 'Pneumonia', NULL, NULL, NULL, 0, 85000, 70000, 15000, 85000, 'APPROVED'),
        ('CLM-2024-00004', (SELECT id FROM policies WHERE policy_number = 'POL-2024-004'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0004'),
         'HOSPITALIZATION', 'DISEASE', '2024-12-01', '2024-12-10', 'Bundang Seoul National Univ. Hospital', 'GENERAL',
         'M54.5', 'Low back pain', NULL, NULL, NULL, 9, 2100000, 1500000, 600000, 2100000, 'PENDING_REVIEW'),
        ('CLM-2024-00005', (SELECT id FROM policies WHERE policy_number = 'POL-2024-005'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0005'),
         'SURGERY', 'DISEASE', '2024-12-08', '2024-12-15', 'Asan Medical Center', 'GENERAL',
         'I21.9', 'Acute myocardial infarction', 'S0802', 'PCI', 4, 7, 12000000, 10000000, 2000000, 12000000, 'AI_PROCESSING'),
        ('CLM-2024-00008', (SELECT id FROM policies WHERE policy_number = 'POL-2024-001'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0001'),
         'OUTPATIENT', 'DISEASE', '2024-11-20', '2024-11-20', 'Seoul University Hospital', 'GENERAL',
         'J18.9', 'Pneumonia', NULL, NULL, NULL, 0, 120000, 90000, 30000, 120000, 'APPROVED'),
        ('CLM-2024-00009', (SELECT id FROM policies WHERE policy_number = 'POL-2024-002'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0002'),
         'HOSPITALIZATION', 'DISEASE', '2024-11-05', '2024-11-10', 'Samsung Medical Center', 'GENERAL',
         'M54.5', 'Low back pain', NULL, NULL, NULL, 5, 900000, 700000, 200000, 900000, 'PENDING_REVIEW'),
        ('CLM-2024-00010', (SELECT id FROM policies WHERE policy_number = 'POL-2024-003'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0003'),
         'SURGERY', 'DISEASE', '2024-10-14', '2024-10-16', 'Gangnam Severance Hospital', 'GENERAL',
         'K80.0', 'Cholelithiasis', 'S0501', 'Cholecystectomy', 2, 2, 2800000, 2100000, 700000, 2800000, 'RECEIVED'),
        ('CLM-2024-00011', (SELECT id FROM policies WHERE policy_number = 'POL-2024-004'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0004'),
         'OUTPATIENT', 'DISEASE', '2024-09-02', '2024-09-02', 'Bundang Seoul National Univ. Hospital', 'GENERAL',
         'J18.9', 'Pneumonia', NULL, NULL, NULL, 0, 60000, 40000, 20000, 60000, 'REJECTED'),
        ('CLM-2024-00012', (SELECT id FROM policies WHERE policy_number = 'POL-2024-005'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0005'),
         'HOSPITALIZATION', 'DISEASE', '2024-08-10', '2024-08-17', 'Asan Medical Center', 'GENERAL',
         'I21.9', 'Acute myocardial infarction', NULL, NULL, NULL, 7, 8000000, 6400000, 1600000, 8000000, 'AI_PROCESSING'),
        ('CLM-2024-00013', (SELECT id FROM policies WHERE policy_number = 'POL-2024-006'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0006'),
         'SURGERY', 'DISEASE', '2024-07-12', '2024-07-12', 'Seoul University Hospital', 'GENERAL',
         'H25.1', 'Senile cataract', 'S1101', 'Cataract surgery', 1, 0, 1500000, 1200000, 300000, 1500000, 'RECEIVED'),
        ('CLM-2024-00014', (SELECT id FROM policies WHERE policy_number = 'POL-2024-007'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0007'),
         'HOSPITALIZATION', 'ACCIDENT', '2024-06-03', '2024-06-09', 'Gangnam Severance Hospital', 'GENERAL',
         'S82.0', 'Patella fracture', 'S0902', 'Knee arthroplasty', 4, 6, 5000000, 3800000, 1200000, 5000000, 'PENDING_REVIEW'),
        ('CLM-2024-00015', (SELECT id FROM policies WHERE policy_number = 'POL-2024-001'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0001'),
         'OUTPATIENT', 'DISEASE', '2024-05-22', '2024-05-22', 'Seoul University Hospital', 'GENERAL',
         'K35.0', 'Acute appendicitis', NULL, NULL, NULL, 0, 95000, 76000, 19000, 95000, 'APPROVED'),
        ('CLM-2024-00016', (SELECT id FROM policies WHERE policy_number = 'POL-2024-002'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0002'),
         'SURGERY', 'DISEASE', '2024-04-11', '2024-04-12', 'Samsung Medical Center', 'GENERAL',
         'K35.0', 'Acute appendicitis', 'S0401', 'Appendectomy', 2, 2, 1200000, 900000, 300000, 1200000, 'APPROVED'),
        ('CLM-2024-00017', (SELECT id FROM policies WHERE policy_number = 'POL-2024-003'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0003'),
         'HOSPITALIZATION', 'DISEASE', '2024-03-05', '2024-03-08', 'Gangnam Severance Hospital', 'GENERAL',
         'J18.9', 'Pneumonia', NULL, NULL, NULL, 3, 700000, 560000, 140000, 700000, 'RECEIVED'),
        ('CLM-2024-00018', (SELECT id FROM policies WHERE policy_number = 'POL-2024-005'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0005'),
         'OUTPATIENT', 'DISEASE', '2024-02-09', '2024-02-09', 'Asan Medical Center', 'GENERAL',
         'M54.5', 'Low back pain', NULL, NULL, NULL, 0, 50000, 35000, 15000, 50000, 'REJECTED'),
        ('CLM-2024-00019', (SELECT id FROM policies WHERE policy_number = 'POL-2024-006'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0006'),
         'OUTPATIENT', 'DISEASE', '2024-01-18', '2024-01-18', 'Seoul University Hospital', 'GENERAL',
         'H25.1', 'Senile cataract', NULL, NULL, NULL, 0, 80000, 64000, 16000, 80000, 'APPROVED'),
        ('CLM-2024-00020', (SELECT id FROM policies WHERE policy_number = 'POL-2024-007'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0007'),
         'SURGERY', 'ACCIDENT', '2024-01-05', '2024-01-07', 'Gangnam Severance Hospital', 'GENERAL',
         'S82.0', 'Patella fracture', 'S0902', 'Knee arthroplasty', 4, 2, 6000000, 4800000, 1200000, 6000000, 'AI_PROCESSING'),
        ('CLM-2024-00021', (SELECT id FROM policies WHERE policy_number = 'POL-2024-001'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0001'),
         'HOSPITALIZATION', 'DISEASE', '2023-12-11', '2023-12-14', 'Seoul University Hospital', 'GENERAL',
         'K35.0', 'Acute appendicitis', 'S0401', 'Appendectomy', 2, 3, 1300000, 1000000, 300000, 1300000, 'APPROVED'),
        ('CLM-2024-00022', (SELECT id FROM policies WHERE policy_number = 'POL-2024-002'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0002'),
         'OUTPATIENT', 'DISEASE', '2023-12-03', '2023-12-03', 'Samsung Medical Center', 'GENERAL',
         'J18.9', 'Pneumonia', NULL, NULL, NULL, 0, 70000, 52000, 18000, 70000, 'RECEIVED'),
        ('CLM-2024-00023', (SELECT id FROM policies WHERE policy_number = 'POL-2024-003'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0003'),
         'SURGERY', 'DISEASE', '2023-11-18', '2023-11-20', 'Gangnam Severance Hospital', 'GENERAL',
         'K80.0', 'Cholelithiasis', 'S0501', 'Cholecystectomy', 2, 2, 2600000, 2000000, 600000, 2600000, 'APPROVED'),
        ('CLM-2024-00024', (SELECT id FROM policies WHERE policy_number = 'POL-2024-004'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0004'),
         'HOSPITALIZATION', 'DISEASE', '2023-11-01', '2023-11-06', 'Bundang Seoul National Univ. Hospital', 'GENERAL',
         'M54.5', 'Low back pain', NULL, NULL, NULL, 5, 1100000, 850000, 250000, 1100000, 'PENDING_REVIEW'),
        ('CLM-2024-00025', (SELECT id FROM policies WHERE policy_number = 'POL-2024-005'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0005'),
         'OUTPATIENT', 'DISEASE', '2023-10-22', '2023-10-22', 'Asan Medical Center', 'GENERAL',
         'I21.9', 'Acute myocardial infarction', NULL, NULL, NULL, 0, 140000, 110000, 30000, 140000, 'REJECTED'),
        ('CLM-2024-00026', (SELECT id FROM policies WHERE policy_number = 'POL-2024-006'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0006'),
         'SURGERY', 'DISEASE', '2023-10-05', '2023-10-05', 'Seoul University Hospital', 'GENERAL',
         'H25.1', 'Senile cataract', 'S1101', 'Cataract surgery', 1, 0, 1400000, 1100000, 300000, 1400000, 'RECEIVED'),
        ('CLM-2024-00027', (SELECT id FROM policies WHERE policy_number = 'POL-2024-007'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0007'),
         'HOSPITALIZATION', 'ACCIDENT', '2023-09-12', '2023-09-16', 'Gangnam Severance Hospital', 'GENERAL',
         'S82.0', 'Patella fracture', 'S0902', 'Knee arthroplasty', 4, 4, 4200000, 3300000, 900000, 4200000, 'PENDING_REVIEW'),
        ('CLM-2024-00028', (SELECT id FROM policies WHERE policy_number = 'POL-2024-001'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0001'),
         'OUTPATIENT', 'DISEASE', '2023-09-01', '2023-09-01', 'Seoul University Hospital', 'GENERAL',
         'J18.9', 'Pneumonia', NULL, NULL, NULL, 0, 65000, 48000, 17000, 65000, 'APPROVED'),
        ('CLM-2024-00029', (SELECT id FROM policies WHERE policy_number = 'POL-2024-002'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0002'),
         'HOSPITALIZATION', 'DISEASE', '2023-08-19', '2023-08-23', 'Samsung Medical Center', 'GENERAL',
         'K35.0', 'Acute appendicitis', 'S0401', 'Appendectomy', 2, 4, 1450000, 1100000, 350000, 1450000, 'RECEIVED'),
        ('CLM-2024-00030', (SELECT id FROM policies WHERE policy_number = 'POL-2024-003'),
         (SELECT id FROM customers WHERE customer_code = 'CUST-0003'),
         'OUTPATIENT', 'DISEASE', '2023-08-02', '2023-08-02', 'Gangnam Severance Hospital', 'GENERAL',
         'M54.5', 'Low back pain', NULL, NULL, NULL, 0, 55000, 40000, 15000, 55000, 'REJECTED')
        ON CONFLICT (claim_number) DO NOTHING;
END $$;

-- Ensure enterprise mock policy_coverages exist even if base seed is skipped.
INSERT INTO policy_coverages (
    id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
    deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
    annual_limit, used_annual_amount, surgery_classification
)
SELECT 20, (SELECT id FROM policies WHERE policy_number = 'POL-2024-004'),
       (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_HOSP_INS'),
       'Inpatient Insured', 'DIS_HOSP_INS', 30000000, 'MAX', 100000, 10, 90, NULL, 30000000, 0, NULL
WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 20);

INSERT INTO policy_coverages (
    id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
    deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
    annual_limit, used_annual_amount, surgery_classification
)
SELECT 21, (SELECT id FROM policies WHERE policy_number = 'POL-2024-005'),
       (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_HOSP_INS'),
       'Inpatient Insured', 'DIS_HOSP_INS', 50000000, 'MAX', 100000, 10, 90, NULL, 50000000, 0, NULL
WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 21);

INSERT INTO policy_coverages (
    id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
    deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
    annual_limit, used_annual_amount, surgery_classification
)
SELECT 22, (SELECT id FROM policies WHERE policy_number = 'POL-2024-005'),
       (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_HOSP_UNINS'),
       'Inpatient Uninsured', 'DIS_HOSP_UNINS', 50000000, 'MAX', 200000, 0, 80, NULL, 50000000, 0, NULL
WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 22);

INSERT INTO policy_coverages (
    id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
    deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
    annual_limit, used_annual_amount, surgery_classification
)
SELECT 23, (SELECT id FROM policies WHERE policy_number = 'POL-2024-005'),
       (SELECT id FROM coverage_types WHERE code = 'FIXED_HOSP_DAILY'),
       'Hospital Daily', 'DIS_HOSP_DAILY', 100000, 'FIXED', 0, 0, 100, 30, 7000000, 0, NULL
WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 23);

INSERT INTO policy_coverages (
    id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
    deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
    annual_limit, used_annual_amount, surgery_classification
)
SELECT 24, (SELECT id FROM policies WHERE policy_number = 'POL-2024-005'),
       (SELECT id FROM coverage_types WHERE code = 'REAL_LOSS_OUT_INS'),
       'Outpatient Insured', 'OUT_INS', 200000, 'FIXED', 10000, 0, 90, NULL, 2400000, 0, NULL
WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 24);

INSERT INTO policy_coverages (
    id, policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount,
    deductible_type, deductible_amount, deductible_rate, payout_rate, max_days,
    annual_limit, used_annual_amount, surgery_classification
)
SELECT 25, (SELECT id FROM policies WHERE policy_number = 'POL-2024-005'),
       (SELECT id FROM coverage_types WHERE code = 'FIXED_SURGERY_4'),
       'Surgery Class 4', 'DIS_SURG_4', 3000000, 'FIXED', 0, 0, 100, NULL, 30000000, 0, 4
WHERE NOT EXISTS (SELECT 1 FROM policy_coverages WHERE id = 25);
