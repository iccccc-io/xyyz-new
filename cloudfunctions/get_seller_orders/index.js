// 云函数：get_seller_orders
// 云函数以管理员权限查询，绕过「仅创建者可读」的数据库安全规则
// 用途：卖家查询属于自己工坊的订单列表
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

/**
 * @param {number|null} event.status  - 筛选状态（20/30/40），null 则查全部
 * @param {number}      event.limit   - 每页数量，默认 20
 * @param {number}      event.skip    - 跳过数量，默认 0
 * @returns {{ success: boolean, data: Array, total: number }}
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { status = null, limit = 20, skip = 0 } = event

  try {
    // ===== 1. 查询调用者的工坊 ID =====
    const userRes = await db.collection('users')
      .where({ _openid: openid, is_certified: true })
      .get()

    if (!userRes.data || userRes.data.length === 0) {
      return { success: false, message: '您尚未认证为传承人，无法查看销售订单', data: [] }
    }

    const workshopId = userRes.data[0].workshop_id
    if (!workshopId) {
      return { success: false, message: '未找到关联工坊', data: [] }
    }

    // ===== 2. 构造查询条件 =====
    const whereClause = { workshop_id: workshopId }

    if (status !== null && status !== undefined) {
      whereClause.status = Number(status)
    } else {
      // 卖家只关心已支付后的订单（10=待付款不显示给卖家）
      whereClause.status = _.in([20, 30, 40, 60])
    }

    // ===== 3. 查询订单 =====
    const [listRes, countRes] = await Promise.all([
      db.collection('shopping_orders')
        .where(whereClause)
        .orderBy('create_time', 'desc')
        .skip(skip)
        .limit(limit)
        .get(),
      db.collection('shopping_orders')
        .where(whereClause)
        .count()
    ])

    return {
      success: true,
      data: listRes.data || [],
      total: countRes.total || 0,
      workshopId
    }

  } catch (err) {
    console.error('[get_seller_orders 异常]', err)
    return { success: false, message: `查询失败：${err.message || '未知错误'}`, data: [] }
  }
}
