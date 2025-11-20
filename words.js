// فایل کلمات بازی
const wordsDatabase = {
    "آسان": [
        {
            category: "میوه‌ها",
            words: ["سیب", "پرتقال", "موز", "انگور", "هلو", "گیلاس", "انار", "انجیر", "خربزه"]
        },
        {
            category: "حیوانات",
            words: ["سگ", "گربه", "موش", "مرغ", "خرگوش", "گوسفند", "گاو", "اسب", "ماهی"]
        },
        {
            category: "وسایل نقلیه",
            words: ["ماشین", "قطار", "کشتی", "هواپیما", "دوچرخه", "موتور", "اتوبوس", "مترو", "ون"]
        }
    ],
    "متوسط": [
        {
            category: "شهرهای ایران",
            words: ["تهران", "مشهد", "اصفهان", "شیراز", "تبریز", "کرج", "قم", "اهواز", "کرمانشاه"]
        },
        {
            category: "کشورها",
            words: ["ایران", "ترکیه", "آلمان", "فرانسه", "ایتالیا", "ژاپن", "چین", "روسیه", "کانادا"]
        },
        {
            category: "رشته‌های تحصیلی",
            words: ["مهندسی", "پزشکی", "حقوق", "روانشناسی", "مدیریت", "کامپیوتر", "معماری", "حسابداری", "شیمی"]
        }
    ],
    "سخت": [
        {
            category: "دانشمندان",
            words: ["ابوریحان", "خیام", "زکریا", "انیشتین", "نیوتن", "داوینچی", "گالیله", "پاستور", "کپلر"]
        },
        {
            category: "مفاهیم فلسفی",
            words: ["وجودشناسی", "معرفت‌شناسی", "اخلاق", "منطق", "زیبایی‌شناسی", "متافیزیک", "دیالکتیک", "پدیدارشناسی", "اگزیستانسیالیسم"]
        },
        {
            category: "عناصر شیمیایی",
            words: ["هیدروژن", "اکسیژن", "نیتروژن", "کربن", "آهن", "طلا", "نقره", "مس", "جیوه"]
        }
    ]
};

// تابع برای دریافت کلمات تصادفی
function getRandomWords(difficulty, count = 10) {
    const difficultyWords = wordsDatabase[difficulty];
    if (!difficultyWords) return [];
    
    const selectedWords = [];
    const usedCategories = new Set();
    
    while (selectedWords.length < count && usedCategories.size < difficultyWords.length) {
        const randomCategoryIndex = Math.floor(Math.random() * difficultyWords.length);
        
        if (!usedCategories.has(randomCategoryIndex)) {
            usedCategories.add(randomCategoryIndex);
            const category = difficultyWords[randomCategoryIndex];
            const randomWordIndex = Math.floor(Math.random() * category.words.length);
            
            selectedWords.push({
                word: category.words[randomWordIndex],
                category: category.category
            });
        }
    }
    
    return selectedWords;
}

module.exports = {
    wordsDatabase,
    getRandomWords
};
