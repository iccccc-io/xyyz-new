const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event) => {
  const { real_name, ich_category, certificates, bio } = event
  const { OPENID: openid } = cloud.getWXContext()

  if (!real_name || !ich_category || !bio) {
    return {
      success: false,
      message: '参数错误：姓名、非遗类别和简介为必填项'
    }
  }

  if (!Array.isArray(certificates) || certificates.length === 0) {
    return {
      success: false,
      message: '参数错误：请至少上传一张证书图片'
    }
  }

  try {
    const userRes = await db.collection('users')
      .where({ _openid: openid })
      .limit(1)
      .get()

    if (!userRes.data || !userRes.data.length) {
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

    const applyRes = await db.collection('apply_records').add({
      data: {
        user_id: user._id,
        openid,
        real_name,
        ich_category,
        certificates,
        bio,
        status: 'approved',
        create_time: db.serverDate(),
        approve_time: db.serverDate()
      }
    })

    const workshopName = `${real_name}的非遗工坊`
    const workshopRes = await db.collection('shopping_workshops').add({
      data: {
        owner_id: openid,
        member_ids: [openid],
        name: workshopName,
        logo: user.avatar_url || '',
        desc: bio,
        real_name,
        ich_category,
        product_count: 0,
        total_sales: 0,
        rating: 0,
        shop_rating: 0,
        shop_review_count: 0,
        create_time: db.serverDate(),
        update_time: db.serverDate()
      }
    })

    const workshopId = workshopRes._id

    await db.collection('users')
      .where({ _openid: openid })
      .update({
        data: {
          is_certified: true,
          real_name,
          ich_category,
          bio,
          workshop_id: workshopId,
          update_time: db.serverDate()
        }
      })

    return {
      success: true,
      message: '认证成功，系统已为您初始化非遗工坊',
      workshop_id: workshopId,
      workshop_name: workshopName,
      apply_record_id: applyRes._id
    }
  } catch (err) {
    console.error('[apply_certification]', err)
    return {
      success: false,
      message: `认证申请失败: ${err.message || '未知错误'}`
    }
  }
}
