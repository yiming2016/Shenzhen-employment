import { InsuranceParams, SourceLink } from './types';

// 各政策依据链接（与 Excel 中单元格上的超链接一致）
const PENSION_SOURCE: SourceLink = {
  name: '养老（广东省人力资源和社会保障厅）',
  url: 'https://hrss.gd.gov.cn/gkmlpt/content/4/4789/post_4789618.html',
  publishDate: '2024-12-15',
};
const MEDICAL_SOURCE: SourceLink = {
  name: '医保（深圳市医疗保障局）',
  url: 'https://hsa.sz.gov.cn/gkmlpt/content/12/12567/post_12567884.html',
  publishDate: '2024-12-15',
};
const UNEMPLOYMENT_SOURCE: SourceLink = {
  name: '失业（深圳市政府在线）',
  url: 'https://www.sz.gov.cn/hdjlpt/detail?pid=3209367',
  publishDate: '2024-12-15',
};
const MINIMUM_WAGE_SOURCE: SourceLink = {
  name: '最低工资（深圳市人社局）',
  url: 'https://hrss.sz.gov.cn/gkmlpt/content/12/12014/post_12014783.html',
  publishDate: '2024-12-15',
};
const AVERAGE_WAGE_SOURCE: SourceLink = {
  name: '在岗职工平均工资（深圳市统计局）',
  url: 'https://tjj.sz.gov.cn/gkmlpt/content/12/12907/post_12907747.html',
  publishDate: '2024-12-15',
};
const INJURY_SOURCE: SourceLink = {
  name: '工伤费率（深圳市人社局）',
  url: 'https://hrss.sz.gov.cn/gkmlpt/content/5/5529/post_5529041.html',
  publishDate: '2024-12-15',
};
const INJURY_REDUCED_SOURCE: SourceLink = {
  name: '工伤费率下调（深圳市人社局）',
  url: 'https://hrss.sz.gov.cn/gkmlpt/content/5/5528/post_5528897.html',
  publishDate: '2024-12-15',
};

/**
 * 默认政策参数（2026-08 从 社保成本.xlsx 提取）。
 * 注意：失业保险缴费基数上限 = 城镇非私营平均工资 × 3 = 191367 × 3 = 574101，
 * 与 Excel 中的公式 G17 = 3*H20 保持一致；如政策口径有变，直接改这里即可。
 */
export const DEFAULT_PARAMS: InsuranceParams = {
  version: '2026-08（取自社保成本.xlsx）',
  minimumWage: 2520,
  averageWage: {
    urbanNonPrivate: 191367,
    urbanNonPrivateOnPost: 193881,
    urbanPrivate: 99220,
  },
  pension: {
    personalRate: 0.08,
    companyRateDeep: 0.17,
    companyRateNonDeep: 0.16,
    flexibleRateDeep: 0.21,
    flexibleRateNonDeep: 0.2,
    baseMin: 4775,
    baseMax: 27549,
  },
  medical: {
    tier1PersonalRate: 0.02,
    tier1CompanyRate: 0.06,
    tier2PersonalRate: 0.005,
    tier2CompanyRate: 0.015,
    flexibleRate: 0.08,
    baseMin: 6733,
    baseMax: 33666,
  },
  maternity: {
    companyRate: 0.005,
    baseMin: 6733,
    baseMax: 33666,
  },
  unemployment: {
    personalRate: 0.002,
    companyRate: 0.008,
    flexibleRate: 0.01,
    baseMin: 2520,
    baseMax: 574101,
  },
  injury: {
    personalRate: 0,
    companyRates: [
      0.0014, // 一类
      0.0028, // 二类
      0.0049, // 三类
      0.0063, // 四类
      0.0066, // 五类
      0.0078, // 六类
      0.0096, // 七类
      0.0114, // 八类
    ],
    industryNames: [
      '软件和信息技术服务业，货币金融服务，资本市场服务，保险业，其他金融业，科技推广和应用服务业，社会工作，广播、电视、电影和影视录音制作业，中国共产党机关，国家机构，人民政协、民主党派，社会保障，群众团体、社会团体和其他成员组织，基层群众自治组织，国际组织',
      '批发业，零售业，仓储业，邮政业，住宿业，餐饮业，电信、广播电视和卫星传输服务，互联网和相关服务，房地产业，租赁业，商务服务业，研究和试验发展，专业技术服务业，居民服务业，其他服务业，教育，卫生，新闻和出版业，文化艺术业',
      '农副食品加工业，食品制造业，酒、饮料和精制茶制造业，烟草制品业，纺织业，木材加工和木、竹、藤、棕、草制品业，文教、工美、体育和娱乐用品制造业，计算机、通信和其他电子设备制造业，仪器仪表制造业，其他制造业，水的生产和供应业，机动车、电子产品和日用产品修理业，水利管理业，生态保护和环境治理业，公共设施管理业，娱乐业',
      '农业，畜牧业，农、林、牧、渔服务业，纺织服装、服饰业，皮革、毛皮、羽毛及其制品和制鞋业，印刷和记录媒介复制业，医药制造业，化学纤维制造业，橡胶和塑料制品业，金属制品业，通用设备制造业，专用设备制造业，汽车制造业，铁路、船舶、航空航天和其他运输设备制造业，电气机械和器材制造业，废弃资源综合利用业，金属制品、机械和设备修理业，电力、热力生产和供应业，燃气生产和供应业，铁路运输业，航空运输业，管道运输业，体育',
      '林业，开采辅助活动，家具制造业，造纸和纸制品业，建筑安装业，建筑装饰和其他建筑业，道路运输业，水上运输业，装卸搬运和运输代理业',
      '渔业，化学原料和化学制品制造业，非金属矿物制品业，黑色金属冶炼和压延加工业，有色金属冶炼和压延加工业，房屋建筑业，土木工程建筑业',
      '石油和天然气开采业，其他采矿业，石油加工、炼焦和核燃料加工业',
      '煤炭开采和洗选业，黑色金属矿采选业，有色金属矿采选业，非金属矿采选业',
    ],
    baseMode: 'wage',
  },
  housingFund: {
    personalRate: 0.05,
    companyRate: 0.05,
  },
  sources: [
    PENSION_SOURCE,
    MEDICAL_SOURCE,
    UNEMPLOYMENT_SOURCE,
    MINIMUM_WAGE_SOURCE,
    AVERAGE_WAGE_SOURCE,
    INJURY_SOURCE,
    INJURY_REDUCED_SOURCE,
  ],
  sourceBySection: {
    pension: [PENSION_SOURCE],
    medical: [MEDICAL_SOURCE],
    // 生育保险未单独给链接，Excel 中生育费率随医保政策执行
    maternity: [MEDICAL_SOURCE],
    unemployment: [UNEMPLOYMENT_SOURCE],
    minimumWage: [MINIMUM_WAGE_SOURCE],
    averageWage: [AVERAGE_WAGE_SOURCE],
    injury: [INJURY_SOURCE, INJURY_REDUCED_SOURCE],
    housingFund: [],
  },
  validity: {
    pension: {
      enterpriseWorkersStart: '2024-07-01',
      enterpriseWorkersEnd: '2025-06-30',
      governmentOrgStart: '2024-01-01',
      governmentOrgEnd: '2024-12-31',
      publishDate: '2024-12-15',
    },
    medical: {
      start: '2026-01-01',
      end: '2026-12-31',
      publishDate: '2025-12-25',
    },
    maternity: {
      start: '2026-01-01',
      end: '2026-12-31',
      publishDate: '2025-12-25',
    },
    unemployment: {
      start: '2024-07-01',
      end: '2025-06-30',
      publishDate: '',
    },
    injury: {
      start: '2024-07-01',
      end: '2025-06-30',
      publishDate: '',
    },
    housingFund: {
      start: '2025-07-01',
      end: '2026-06-30',
      publishDate: '',
      note: '周期内可调整一次基数、比例',
    },
  },
};
