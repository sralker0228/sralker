require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Храним выбранную группу для каждого чата/темы
const userGroups = {};

const dayNamesRu = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

function getDbDayOfWeek() {
  const jsDay = new Date().getDay();
  return jsDay; 
}

function formatTime(t) {
  return t.slice(0, 5); 
}

function toMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// Универсальная функция для отправки сообщений (учитывает темы/форумы в группах)
function sendReply(msg, text, options = {}) {
  const chatId = msg.chat.id;
  const threadId = msg.message_thread_id;
  const sendOptions = { ...options };
  if (threadId) {
    sendOptions.message_thread_id = threadId;
  }
  return bot.sendMessage(chatId, text, sendOptions);
}

// Уникальный ключ для сохранения группы (учитывает тему, если она есть)
function getStorageKey(msg) {
  const chatId = msg.chat.id;
  const threadId = msg.message_thread_id;
  return threadId ? `${chatId}_${threadId}` : `${chatId}`;
}

// /start — выбор группы (поддерживает команды с @username бота в группах)
bot.onText(/\/start(@\w+)?/, async (msg) => {
  const key = getStorageKey(msg);
  const { data: groups, error } = await supabase.from('groups').select('*').order('name');

  if (error) {
    console.error('Ошибка запроса к Supabase (groups):', error);
    sendReply(msg, 'Не удалось загрузить список групп. Попробуйте позже.');
    return;
  }
  if (!groups || groups.length === 0) {
    sendReply(msg, 'Список групп пуст. Проверьте таблицу groups в Supabase.');
    return;
  }

  // Передаем ключ в callback_data, чтобы бот понимал, куда сохранять группу
  const keyboard = groups.map((g) => [{ text: g.name, callback_data: `group_${g.id}_${key}` }]);
  sendReply(msg, 'Привет! Выбери свою группу:', {
    reply_markup: { inline_keyboard: keyboard },
  });
});

// Обработка нажатия на кнопку выбора группы
bot.on('callback_query', async (query) => {
  const data = query.data;

  if (data.startsWith('group_')) {
    const parts = data.split('_');
    const groupId = parts[1];
    const key = parts.slice(2).join('_');

    userGroups[key] = groupId;
    
    await bot.answerCallbackQuery(query.id, { text: 'Группа сохранена!' });
    
    // Отправляем подтверждение в тот же чат/тему
    const chatId = query.message.chat.id;
    const threadId = query.message.message_thread_id;
    const sendOptions = threadId ? { message_thread_id: threadId } : {};

    bot.sendMessage(
      chatId,
      'Готово! Доступные команды:\n/today — расписание на сегодня\n/now — какая пара идёт сейчас',
      sendOptions
    );
  }
});

// /today — расписание на сегодня
bot.onText(/\/today(@\w+)?/, async (msg) => {
  const key = getStorageKey(msg);
  const groupId = userGroups[key];

  if (!groupId) {
    sendReply(msg, 'Сначала выбери группу командой /start');
    return;
  }

  const dbDay = getDbDayOfWeek();
  if (dbDay === 0) {
    sendReply(msg, 'Сегодня воскресенье, пар нет 🎉');
    return;
  }

  const { data: lessons, error } = await supabase
    .from('schedule')
    .select('*')
    .eq('group_id', groupId)
    .eq('day_of_week', dbDay)
    .order('lesson_number');

  if (error) {
    sendReply(msg, 'Ошибка при получении расписания.');
    return;
  }

  if (!lessons || lessons.length === 0) {
    sendReply(msg, 'На сегодня пар нет.');
    return;
  }

  let text = `Расписание на сегодня (${dayNamesRu[new Date().getDay()]}):\n\n`;
  lessons.forEach((l) => {
    text += `${l.lesson_number} пара: ${l.subject_name} (${formatTime(l.time_start)} - ${formatTime(l.time_end)})\n`;
  });

  sendReply(msg, text);
});

// /now — какая пара идёт прямо сейчас
bot.onText(/\/now(@\w+)?/, async (msg) => {
  const key = getStorageKey(msg);
  const groupId = userGroups[key];

  if (!groupId) {
    sendReply(msg, 'Сначала выбери группу командой /start');
    return;
  }

  const dbDay = getDbDayOfWeek();
  if (dbDay === 0) {
    sendReply(msg, 'Сегодня воскресенье, пар нет 🎉');
    return;
  }

  const { data: lessons, error } = await supabase
    .from('schedule')
    .select('*')
    .eq('group_id', groupId)
    .eq('day_of_week', dbDay)
    .order('lesson_number');

  if (error || !lessons || lessons.length === 0) {
    sendReply(msg, 'На сегодня пар нет.');
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
    sendReply(
      msg,
      `Сейчас идёт ${current.lesson_number} пара: ${current.subject_name} (${formatTime(current.time_start)} - ${formatTime(current.time_end)})`
    );
  } else if (next) {
    sendReply(
      msg,
      `Сейчас перемена. Следующая пара в ${formatTime(next.time_start)}: ${next.subject_name}`
    );
  } else {
    sendReply(msg, 'На сегодня все пары закончились.');
  }
});

console.log('Бот запущен и слушает сообщения...');