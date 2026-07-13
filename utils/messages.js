const MESSAGES = {
    SUCCESS: {
        ar: "تم جلب بيانات أول بصمة بنجاح.",
        en: "First check-in data retrieved successfully."
    },
    NOT_FOUND: {
        ar: "الموظف لم يسجل حضوره بعد.",
        en: "Employee has not checked in today yet."
    },
    REQUIRED_ID: {
        ar: "يرجى إرسال رقم الموظف (empId) لإتمام العملية.",
        en: "Employee ID (empId) is required to process the request."
    },
    SERVER_ERROR: {
        ar: "حدث خطأ تقني داخلي أثناء محاولة جلب البيانات.",
        en: "An internal technical error occurred while fetching data."
    }
};

function getMessage(lang = 'ar', type) {
    switch (type) {
        case 'SUCCESS':
            return lang == 'ar' ? MESSAGES.SUCCESS.ar : MESSAGES.SUCCESS.en
    
        case 'NOT_FOUND':
            return lang == 'ar' ? MESSAGES.NOT_FOUND.ar : MESSAGES.NOT_FOUND.en
    
        case 'REQUIRED_ID':
            return lang == 'ar' ? MESSAGES.REQUIRED_ID.ar : MESSAGES.REQUIRED_ID.en
    
        case 'SERVER_ERROR':
        default:
            return lang == 'ar' ? MESSAGES.SERVER_ERROR.ar : MESSAGES.SERVER_ERROR.en

    }
}

module.exports = {getMessage}