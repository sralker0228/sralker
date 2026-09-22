if (error || !lessons || lessons.length === 0) {
    bot.sendMessage(chatId, 'На сегодня пар нет.');
    return;
  }

  const localDate = getLocalDate();
  const nowMinutes = localDate.getUTCHours() * 60 + localDate.getUTCMinutes();

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