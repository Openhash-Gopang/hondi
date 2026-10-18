# 미연결 서버 task 정리 (열린 문제 #5, 2026-10-19 13회차)

서버 task 145개 중 기관 페이지에 연결되지 않은 것은 처음 29개였고, 이번에 1건을 연결해 28개가 남았다. 연결 규칙은 `tools/extract-gov-tasks.cjs` 머리말과 같다: ① 그 기관의 SP 가 task_key 를 자기 접수 업무로 직접 적고 ② 서버 `AGENCY_TO_DEPT_TARGET` 의 부서 지정과 모순이 없을 때만 `TASK_AGENCY_OVERRIDE` 에 올린다(테스트가 ①을 검사). 추측으로 잇지 않는다.

## 이번에 연결한 것 (1건)
| task | 기관 | 근거 |
|---|---|---|
| `seogwipo:basic_livelihood_benefit_application` | `city-dept:seogwipo:SP-CITYDIV-SEOGWIPO-WELFARE-RESIDENT` | SP v1.2(59행)가 「서귀포시청은 기초생활보장과가 별도로 없어 이 과가 겸한다」고 밝히고 task_key 를 직접 적음. 서버 지정 `city-dept:seogwipo:welfare` 와 모순 없음 |

## A. 후보 SP 가 하나로 좁혀지지만 SP 가 task_key 를 적지 않은 것 (SP 담당자 확인 후 연결 가능)
SP 의 「입력」 줄이 같은 업무를 다루고 서버 부서(국 단위)가 SP 의 소속 국과 일치한다. 연결하려면 해당 SP 에 task_key 접수 선언을 추가해야 한다(테스트 규칙).

| task | 후보 기관 코드 | SP 근거(입력 줄) |
|---|---|---|
| `seogwipo:library_membership_registration` | `city-dept:seogwipo:SP-CITYDIV-SEOGWIPO-CULTURE-LIBRARYMGMT` | 「도서관 회원가입 신청」 50행 |
| `seogwipo:performance_hall_rental` | `city-dept:seogwipo:SP-CITYDIV-SEOGWIPO-CULTURE-ARTSHALL` | 「공연장 대관 신청서」 50행 |
| `seogwipo:sports_facility_rental` | `city-dept:seogwipo:SP-CITYDIV-SEOGWIPO-CULTURE-SPORTS` | 「체육시설 이용·대관 신청서」 50행 |
| `jejusi:sports_facility_rental` | `city-dept:jejusi:SP-CITYDIV-JEJUSI-CULTURE-SPORTS` | 같은 줄 50행 |
| `seogwipo:forest_recreation_facility_reservation` | `city-dept:seogwipo:SP-CITYDIV-SEOGWIPO-CLIMATE-FORESTRECREATION` | 「서귀포휴양림 운영 및 관리」 66행 |
| `seogwipo:citrus_shipment_report` | `city-dept:seogwipo:SP-CITYDIV-SEOGWIPO-AGRIECONOMY-CITRUS` | 「감귤 출하 신고」 50행 |
| `seogwipo:eco_friendly_farming_certification` | `city-dept:seogwipo:SP-CITYDIV-SEOGWIPO-AGRIECONOMY-ECOFARM` | 「친환경농업 인증 신청서」 50행 |
| `jejusi:bulky_waste_disposal_sticker` | `city-dept:jejusi:SP-CITYDIV-JEJUSI-CLIMATE-LIVINGENV` | 「대형폐기물 배출 스티커 발급」 51행 |
| `seogwipo:bulky_waste_disposal_sticker` | `city-dept:seogwipo:SP-CITYDIV-SEOGWIPO-CLIMATE-LIVINGENV` | 같은 줄 51행 |
| `jejusi:waste_disposal_facility_intake` | `city-dept:jejusi:SP-CITYDIV-JEJUSI-CLIMATE-FACILITY` | 「사업장 폐기물 반입 신청」 50행 |
| `jeju:youth_inflow_incentive_application` | `do-dept:jeju:SP-DIV-PLAN-POPULATION` | 「청년 전입 지원 관련 신청」 45행 |
| `jeju:hospital_establishment_permit` | `do-dept:jeju:SP-DIV-SAFETY-HEALTHPOLICY` | 「의료기관 개설 관련 문의」 35행(SP 는 일반 안내까지만 직접 수행한다고 적음 — 접수 선언 여부는 담당자 확인) |

## B. 후보가 둘 이상이거나 SP 쪽 업무가 보이지 않는 것
| task | 사정 |
|---|---|
| `jejusi:library_membership_registration` | 서버 기관명 「문화체육국 (우당/탐라도서관)」. 후보가 우당도서관·탐라도서관 두 SP(둘 다 같은 입력 줄) |
| `jejusi:performance_hall_rental` | 서버 기관명 「문화예술회관」. 색인에 같은 이름이 없고 공연장 대관을 적은 `SP-CITYDIV-JEJUSI-CULTURE-ARTCENTER`(제주아트센터, 50행)가 후보. 같은 시설인지 담당자 확인 필요 |
| `seogwipo:art_museum_exhibition_rental` | 서버 기관명 「예술관」. 색인에 같은 이름이 없고 전시 대관을 적은 `SP-CITYDIV-SEOGWIPO-CULTURE-ARTMUSEUM`(서귀포 공립미술관, 50행)이 후보. 같은 시설인지 담당자 확인 필요 |
| `jejusi:forest_recreation_facility_reservation` | 휴양림 언급 SP 가 절물·공원 등 여럿 |
| `seogwipo:vaccination_reservation` | 서귀포보건소 SP 가 건강증진과·동부·서부보건소로 나뉘고 예방접종을 적은 SP 가 없음 |
| `jejusi:property_tax_correction_request` | 열린 문제 #1(세무과 vs 재산세과) |
| `jeju:ev_purchase_subsidy_application` | 서버 부서는 `do-dept:innov`(혁신산업국)인데 전기차 보조금 언급은 `SP-DO-CLIMATE`(국 단위 SP) — 부서 불일치 |
| `jeju:renewable_power_business_permit`, `jeju:development_project_approval` | 대응 SP 가 없음(개발사업은 `housing` 지정이나 SP 언급은 템플릿 데이터뿐) |
| `jeju:hallasan_special_entry_permit` | 열린 문제 #9 |
| `childmeal:kids_food_service_registration`, `transweak:special_transport_registration`, `jtp:equipment_testing_request`, `jeda:digital_transformation_package_support` | 기관 색인에는 `org:SP-ORG-…` 가 있으나 서버 기관명(「제주 어린이급식관리지원센터」 등)과 색인 이름이 정확히 같지 않고, SP 가 task_key 를 적지 않음. 서버 대상은 `org:CHILDMEAL`/`TRANSWEAK`/`JTP`/`JEDA` |
| `kcc:location_service_registration`, `court:personal_bankruptcy_filing` | 중앙기관·법원 task. 이 저장소의 기관 색인에 대응 항목 없음(지역 기관 페이지 대상이 아님) |

## 다음 단계
A표의 12건은 SP 담당자가 task_key 접수 선언을 SP 에 추가하면 같은 방식으로 연결할 수 있다. B표는 담당자가 기관을 정해 주어야 한다.
