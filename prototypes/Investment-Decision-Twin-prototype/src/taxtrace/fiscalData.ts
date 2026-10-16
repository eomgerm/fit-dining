export type FiscalField = {
  id: string
  label: string
  budgetEok: number
  executionEok: number
  color: string
  description: string
}

const fields: FiscalField[] = [
  { id: 'social-welfare', label: '사회복지', budgetEok: 2_278_115, executionEok: 2_203_771, color: '#173f3a', description: '연금·고용·주택·취약계층 지원' },
  { id: 'general-admin', label: '일반·지방행정', budgetEok: 1_102_623, executionEok: 1_083_407, color: '#31564d', description: '중앙·지방행정과 재정 이전' },
  { id: 'education', label: '교육', budgetEok: 898_527, executionEok: 853_079, color: '#46695d', description: '학교·대학·평생교육' },
  { id: 'defense', label: '국방', budgetEok: 587_464, executionEok: 564_843, color: '#779174', description: '국방 및 병력 운영' },
  { id: 'industry-energy', label: '산업·중소기업·에너지', budgetEok: 283_154, executionEok: 278_506, color: '#9ab68e', description: '산업·창업·에너지 지원' },
  { id: 'agriculture', label: '농림수산', budgetEok: 262_847, executionEok: 245_170, color: '#b8c595', description: '농림·해양·수산 지원' },
  { id: 'public-safety', label: '공공질서·안전', budgetEok: 247_269, executionEok: 243_442, color: '#d4d79d', description: '치안·재난·사법' },
  { id: 'transport', label: '교통·물류', budgetEok: 228_136, executionEok: 209_895, color: '#d8ff52', description: '도로·철도·물류' },
  { id: 'health', label: '보건', budgetEok: 196_938, executionEok: 195_471, color: '#ff8f70', description: '보건의료와 건강보험 지원' },
  { id: 'environment', label: '환경', budgetEok: 126_320, executionEok: 111_765, color: '#e6aa86', description: '환경·기후·수자원' },
  { id: 'communications', label: '통신', budgetEok: 97_519, executionEok: 95_545, color: '#c3a9d5', description: '정보통신 및 디지털 기반' },
  { id: 'science', label: '과학기술', budgetEok: 93_874, executionEok: 92_706, color: '#a9bcd5', description: '연구개발과 과학기술' },
  { id: 'culture', label: '문화·관광', budgetEok: 88_959, executionEok: 85_067, color: '#d9d5ca', description: '문화예술·체육·관광' },
  { id: 'diplomacy', label: '통일·외교', budgetEok: 76_203, executionEok: 63_933, color: '#b9b6aa', description: '외교·국제협력·통일' },
  { id: 'territory', label: '국토·지역개발', budgetEok: 45_748, executionEok: 42_695, color: '#c8c5b8', description: '지역개발과 국토 관리' },
  { id: 'reserve', label: '예비비', budgetEok: 31_838, executionEok: 6_383, color: '#e8e5dc', description: '예측하기 어려운 지출 대비' },
]

export const fiscalSnapshot = {
  fiscalYear: 2024,
  collectedAt: '2026-10-05',
  unit: '억원',
  totalBudgetEok: 6_645_534,
  totalExecutionEok: 6_375_678,
  fields,
  project: {
    code: '일반회계 1034-311',
    name: '청년월세 한시 특별지원',
    ministry: '국토교통부',
    field: '사회복지',
    sector: '주택',
    program: '주택시장안정및주거복지향상',
    unitProject: '주택정책지원',
    originalBudgetWon: 79_351_000_000,
    adjustmentWon: 511_600_000,
    currentBudgetWon: 79_862_600_000,
    executionWon: 79_862_600_000,
    carryoverWon: 0,
    unusedWon: 0,
  },
  sources: {
    fieldExecution: 'https://openapi.openfiscaldata.go.kr/OPFI117?ACNT_YR=2024',
    projectSettlement: 'https://openapi.openfiscaldata.go.kr/VW_OPFI379?ACNT_YR=2024',
    molitBudget: 'https://www.molit.go.kr/portal/common/download/DownloadMltm2.jsp?FileName=2024%EB%85%84+%EC%98%88%EC%82%B0%EC%84%9C%28%EA%B0%81%EB%AA%A9%EB%AA%85%EC%84%B8%EC%84%9C_%ED%99%95%EC%A0%95%29%EA%B8%B0%EA%B8%88%ED%8F%AC%ED%95%A8.pdf&FilePath=portal%2FDextUpload%2F202401%2F20240104_132002_999.pdf',
    naboAccounts: 'https://korea.nabo.go.kr/board/file/down.do?fid=33318646',
    youthPolicyPlan: 'https://www.opm.go.kr/opm/info/youth_implementation.do?articleNo=159017&attachNo=147916&mode=download',
    molitAnnouncement: 'https://www.molit.go.kr/USR/NEWS/m_71/dtl.jsp?id=95089452&lcmspage=14',
  },
} as const

