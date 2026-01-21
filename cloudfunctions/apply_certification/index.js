// 云函数入口文件 - 非遗传承人认证申请
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

/**
 * 非遗传承人认证申请云函数
 * 
 * 功能：
 * 1. 保存认证申请记录到 apply_records 集合
 * 2. 自动创建工坊并写入 shopping_workshops 集合
 * 3. 更新用户表 users，设置 is_certified: true 并绑定 workshop_id
 * 
 * @param {Object} event - 请求参数
 * @param {String} event.real_name - 真实姓名
 * @param {String} event.ich_category - 非遗类别
 * @param {Array} event.certificates - 证书图片文件ID数组
 * @param {String} event.bio - 工坊简介
 * 
 * @returns {Object} { success: Boolean, message: String, workshop_id: String }
 */
exports.main = async (event, context) => {
  const { real_name, ich_category, certificates, bio } = event
  
  // 获取调用者 openid
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  console.log(`[认证申请] 用户 ${openid} 发起认证申请`)

  // ========== 参数校验 ==========
  if (!real_name || !ich_category || !bio) {
    return {
      success: false,
      message: '参数错误：姓名、非遗类别和简介为必填项'
    }
  }

  if (!certificates || !Array.isArray(certificates) || certificates.length === 0) {
    return {
      success: false,
      message: '参数错误：请至少上传一张证书图片'
    }
  }

  try {
    // ========== 1. 检查用户是否已认证 ==========
    const userRes = await db.collection('users')
      .where({ _openid: openid })
      .get()

    if (!userRes.data || userRes.data.length === 0) {
      return {
        success: false,
        message: '用户信息不存在，请先完成登录'
      }
    }

    const user = userRes.data[0]
    
    if (user.is_certified) {
      return {
        success: false,
        message: '您已通过认证，无需重复申请'
      }
    }

    // ========== 2. 保存认证申请记录 ==========
    const applyRecord = {
      user_id: user._id,
      openid: openid,
      real_name: real_name,
      ich_category: ich_category,
      certificates: certificates,
      bio: bio,
      status: 'approved', // 模拟自动通过
      create_time: db.serverDate(),
      approve_time: db.serverDate()
    }

    const applyRes = await db.collection('apply_records').add({
      data: applyRecord
    })

    console.log(`[认证申请] 申请记录已保存，ID: ${applyRes._id}`)

    // ========== 3. 创建工坊 ==========
    const workshopName = `${real_name}的非遗工坊`
    
    const workshopData = {
      owner_id: openid,
      member_ids: [openid], // 初始仅包含创建者，预留多人共营扩展
      name: workshopName,
      logo: user.avatar_url || '', // 使用用户头像作为工坊Logo
      desc: bio,
      real_name: real_name, // 保存真实姓名
      ich_category: ich_category, // 保存非遗类别
      product_count: 0, // 商品数量
      total_sales: 0, // 总销量
      rating: 5.0, // 初始评分
      create_time: db.serverDate(),
      update_time: db.serverDate()
    }

    const workshopRes = await db.collection('shopping_workshops').add({
      data: workshopData
    })

    const workshopId = workshopRes._id
    console.log(`[认证申请] 工坊已创建，ID: ${workshopId}`)

    // ========== 4. 更新用户表，升级为传承人身份 ==========
    await db.collection('users')
      .where({ _openid: openid })
      .update({
        data: {
          is_certified: true,
          real_name: real_name,
          ich_category: ich_category,
          bio: bio,
          workshop_id: workshopId,
          update_time: db.serverDate()
        }
      })

    console.log(`[认证申请] 用户 ${openid} 已升级为传承人，绑定工坊 ${workshopId}`)

    // ========== 5. 返回成功结果 ==========
    return {
      success: true,
      message: '认证成功！系统已为您自动初始化非遗工坊',
      workshop_id: workshopId,
      workshop_name: workshopName
    }

  } catch (err) {
    console.error('[认证申请失败]', err)
    return {
      success: false,
      message: `认证申请失败: ${err.message || '未知错误'}`
    }
  }
}

