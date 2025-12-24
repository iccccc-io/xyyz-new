// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// ========== 安全白名单配置 ==========
// 定义允许更新的集合和字段
const ALLOW_LIST = {
  'community_posts': ['comment_count', 'likes', 'views', 'collection_count'],
  'community_comments': ['reply_count', 'like_count'],
  'community_topics': ['count'],  // 话题热度统计
  'users': ['stats.followers', 'stats.following', 'stats.likes']
}

/**
 * 通用原子更新云函数
 * 
 * @param {Object} event - 请求参数
 * @param {String} event.collection - 目标集合名称
 * @param {String} event.docId - 目标文档 _id（与 whereField 二选一）
 * @param {String} event.whereField - 查询字段名（如 '_openid'，与 docId 二选一）
 * @param {String} event.whereValue - 查询字段值
 * @param {String} event.field - 要更新的字段名
 * @param {Number} event.amount - 变化数值（正数增加，负数减少）
 * 
 * @returns {Object} { success: Boolean, message: String }
 */
exports.main = async (event, context) => {
  const { collection, docId, whereField, whereValue, field, amount } = event
  
  // 获取调用者信息（用于日志记录）
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  // ========== 参数校验 ==========
  if (!collection || typeof collection !== 'string') {
    return {
      success: false,
      message: '参数错误：collection 必须是非空字符串'
    }
  }

  // docId 和 whereField/whereValue 二选一
  const useDocId = docId && typeof docId === 'string'
  const useWhere = whereField && whereValue && typeof whereField === 'string'

  if (!useDocId && !useWhere) {
    return {
      success: false,
      message: '参数错误：必须提供 docId 或 (whereField + whereValue)'
    }
  }

  if (!field || typeof field !== 'string') {
    return {
      success: false,
      message: '参数错误：field 必须是非空字符串'
    }
  }

  if (typeof amount !== 'number' || isNaN(amount)) {
    return {
      success: false,
      message: '参数错误：amount 必须是有效数字'
    }
  }

  // ========== 安全白名单校验 ==========
  const allowedFields = ALLOW_LIST[collection]
  
  if (!allowedFields) {
    console.warn(`[安全警告] 用户 ${openid} 尝试访问未授权的集合: ${collection}`)
    return {
      success: false,
      message: `安全错误：集合 "${collection}" 不在允许更新的白名单中`
    }
  }

  if (!allowedFields.includes(field)) {
    console.warn(`[安全警告] 用户 ${openid} 尝试更新未授权的字段: ${collection}.${field}`)
    return {
      success: false,
      message: `安全错误：字段 "${field}" 不在集合 "${collection}" 的允许更新列表中`
    }
  }

  // ========== 执行原子更新 ==========
  try {
    // 构造更新数据对象
    // 支持嵌套字段如 'stats.followers'
    const updateData = {}
    updateData[field] = _.inc(amount)

    let result

    if (useDocId) {
      // 通过文档 ID 更新
      result = await db.collection(collection).doc(docId).update({
        data: updateData
      })
      console.log(`[更新成功] 用户 ${openid} 通过 docId 更新了 ${collection}.${docId}.${field}，变化值: ${amount}`)
    } else {
      // 通过 where 条件更新
      const whereCondition = {}
      whereCondition[whereField] = whereValue
      
      result = await db.collection(collection).where(whereCondition).update({
        data: updateData
      })
      console.log(`[更新成功] 用户 ${openid} 通过 where(${whereField}=${whereValue}) 更新了 ${collection}.${field}，变化值: ${amount}`)
    }

    return {
      success: true,
      message: '更新成功',
      updated: result.stats.updated
    }

  } catch (err) {
    console.error(`[更新失败] 用户 ${openid} 更新 ${collection}.${field} 时发生错误:`, err)
    
    return {
      success: false,
      message: `数据库更新失败: ${err.message || '未知错误'}`
    }
  }
}
