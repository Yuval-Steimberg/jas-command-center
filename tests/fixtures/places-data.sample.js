// JAS Route — Places & Categories Data
// Manage this data via admin/place-editor.html

const CATS = {
  anchor:    {label:'Just a Second', icon:'📍', color:'#3D5443'},
  cafe:      {label:'קפה ואוכל',     icon:'☕', color:'#B8762A'},
  photo:     {label:'צילום',          icon:'📷', color:'#3A6E8F'},
  art:       {label:'אמנות',          icon:'🎨', color:'#7B4F9E'},
  design:    {label:'עיצוב ויצירה',  icon:'🏺', color:'#3E7A4A'},
  events:    {label:'מרחבים',         icon:'🏛️', color:'#2D7A7E'},
  community: {label:'קהילה',          icon:'🫂', color:'#8A7A25'},
  fashion:   {label:'אופנה',          icon:'👗', color:'#9B2D7F'},
};

const LOCS = [
  {id:1,  name:'Just A Second', sub:'חנות גלריה | בתי מלאכה | פינת קפה פתוחה לקהל', cat:'anchor', lat:32.0620681, lng:34.7780304, desc:'מוזמנים אלינו ליהנות משפע של פריטים בשימוש חוזר ובמחדוש, כל פריט מיוחד במינו.\n\nכל הרווחים מופנים לסיוע נפשי ללוחמים וללוחמות.\n\nיזמנו את המפה מתוך רצון לחזק את העסקים, היצירה והקהילה המקומית', hours:"א׳–ה׳ 11:00–17:00 | ו׳ 10:00–14:00 | נא להתעדכן גם באתר", contact:'058-7876549', address:'בגין 34, תל אביב'},
  {id:2,  name:'Studio Oh', sub:'סטודיו לעיצוב תכשיטים, בגדים ופרטי עיצוב בעבודת יד.', cat:'design', lat:32.0625157, lng:34.7785068, desc:'סטודיו לעיצוב תכשיטים ייחודיים בלב השכונה. הגעה בתיאום מראש.', hours:"א׳–ש׳ | בתיאום מראש", contact:'studioohdesign@gmail.com | רינת — 054-4200688 | מיכל — 050-8686190', address:'השפלה 2, תל אביב'},
  {id:3,  name:'סטודיו גברא', sub:'בית ספר לצילום', cat:'photo', lat:32.0618, lng:34.7778, desc:"בית הספר הותיק לצילום בישראל — כ-60 שנה. קואופרטיב הצילום הראשון בישראל, עם חדר חושך וגלריה שיתופית.", hours:"א׳–ש׳ | בתיאום מראש", contact:null, address:'מנחם בגין 30, תל אביב'},
];
