require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Храним выбранную группу для каждого чата (в памяти)
const userGroups = {};

const dayNamesRu = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

// JS Date.getDay(): 0 = Вс, 1 = Пн ... 6 = Сб
// В базе: 1 = Пн ... 6 = Сб. Воскресенье (0) считаем выходным.
function getDbDayOfWeek() {
  const jsDay = new Date().getDay();
  return jsDay; // 0..6, 0 = воскресенье (пар нет)
}

function formatTime(t) {
  return t.slice(0, 5); // "09:55:00" -> "09:55"
}

function toMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// /start — выбор группы
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const { data: groups, error } = await supabase.from('groups').select('*').order('name');

  if (error) {
    console.error('Ошибка запроса к Supabase (groups):', error);
    bot.sendMessage(chatId, 'Не удалось загрузить список групп. Попробуйте позже.');
    return;
  }
  if (!groups || groups.length === 0) {
    console.error('Таблица groups пуста или запрос вернул 0 строк.');
    bot.sendMessage(chatId, 'Список групп пуст. Проверьте таблицу groups в Supabase.');
    return;
  }

  const keyboard = groups.map((g) => [{ text: g.name, callback_data: `group_${g.id}` }]);
  bot.sendMessage(chatId, 'Привет! Выбери свою группу:', {
    reply_markup: { inline_keyboard: keyboard },
  });
});

// Обработка нажатия на кнопку выбора группы
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith('group_')) {
    const groupId = data.split('_')[1];
    userGroups[chatId] = groupId;
    bot.answerCallbackQuery(query.id, { text: 'Группа сохранена!' });
    bot.sendMessage(
      chatId,
      'Готово! Доступные команды:\n/today — расписание на сегодня\n/now — какая пара идёт сейчас'
    );
  }
});

// /today — расписание на сегодня
bot.onText(/\/today/, async (msg) => {
  const chatId = msg.chat.id;
  const groupId = userGroups[chatId];

  if (!groupId) {
    bot.sendMessage(chatId, 'Сначала выбери группу командой /start');
    return;
  }

  const dbDay = getDbDayOfWeek();
  if (dbDay === 0) {
    bot.sendMessage(chatId, 'Сегодня воскресенье, пар нет 🎉');
    return;
  }

  const { data: lessons, error } = await supabase
    .from('schedule')
    .select('*')
    .eq('group_id', groupId)
    .eq('day_of_week', dbDay)
    .order('lesson_number');

  if (error) {
    bot.sendMessage(chatId, 'Ошибка при получении расписания.');
    return;
  }

  if (!lessons || lessons.length === 0) {
    bot.sendMessage(chatId, 'На сегодня пар нет.');
    return;
  }

  let text = `Расписание на сегодня (${dayNamesRu[new Date().getDay()]}):\n\n`;
  lessons.forEach((l) => {
    text += `${l.lesson_number} пара: ${l.subject_name} (${formatTime(l.time_start)} - ${formatTime(l.time_end)})\n`;
  });

  bot.sendMessage(chatId, text);
});

// /now — какая пара идёт прямо сейчас
bot.onText(/\/now/, async (msg) => {
  const chatId = msg.chat.id;
  const groupId = userGroups[chatId];

  if (!groupId) {
    bot.sendMessage(chatId, 'Сначала выбери группу командой /start');
    return;
  }

  const dbDay = getDbDayOfWeek();
  if (dbDay === 0) {
    bot.sendMessage(chatId, 'Сегодня воскресенье, пар нет 🎉');
    return;
  }

  const { data: lessons, error } = await supabase
    .from('schedule')
    .select('*')
    .eq('group_id', groupId)
    .eq('day_of_week', dbDay)
    .order('lesson_number');

  if (error || !lessons || lessons.length === 0) {
    bot.sendMessage(chatId, 'На сегодня пар нет.');
    return;
  }

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  let current = null;
  let next = null;

  for (const l of lessons) {
    const start = toMinutes(l.time_start);
    const end = toMinutes(l.time_end);

    if (nowMinutes >= start && nowMinutes < end) {
      current = l;
      break;
    }
    if (nowMinutes < start && !next) {
      next = l;
    }
  }

  if (current) {
    bot.sendMessage(
      chatId,
      `Сейчас идёт ${current.lesson_number} пара: ${current.subject_name} (${formatTime(current.time_start)} - ${formatTime(current.time_end)})`
    );
  } else if (next) {
    bot.sendMessage(
      chatId,
      `Сейчас перемена. Следующая пара в ${formatTime(next.time_start)}: ${next.subject_name}`
    );
  } else {
    bot.sendMessage(chatId, 'На сегодня все пары закончились.');
  }
});

console.log('Бот запущен и слушает сообщения...');
