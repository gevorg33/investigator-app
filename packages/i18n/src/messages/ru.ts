import type { Catalog } from './catalog.js';

/**
 * Russian. Typed against the English catalog: a missing key, an extra key or a wrong nesting is a
 * compile error, so the build fails (T-128). Not yet reviewed by a native speaker (ACTIONS-FOR-ME).
 */
export const ru: Catalog = {
  app: {
    name: 'Investigator',
  },
  shell: {
    skip_to_content: 'Перейти к содержимому',
    nav: {
      label: 'Основное',
    },
  },
  nav: {
    home: 'Главная',
    missions: 'Задания',
    messages: 'Чаты',
    assistant: 'Ассистент',
    account: 'Аккаунт',
  },
  home: {
    empty: {
      title: 'Пока ничего не требует вашего внимания',
      body: 'Здесь будут собираться предложения на рассмотрение, новые сообщения и обновления по заказам.',
    },
  },
  missions: {
    empty: {
      title: 'Заданий пока нет',
      body: 'Здесь появятся задания, которые вы создали или над которыми работаете как детектив.',
    },
  },
  messages: {
    empty: {
      title: 'Переписки пока нет',
      body: 'Здесь появится переписка с детективами и заказчиками по заданиям.',
    },
  },
  assistant: {
    empty: {
      title: 'Ассистент скоро появится',
      body: 'Спросите, как устроена платформа, или опишите, что вам нужно, — и он подберёт подходящих детективов.',
    },
  },
  account: {
    empty: {
      title: 'Ваш аккаунт',
      body: 'Здесь можно будет управлять профилем, входом и настройками конфиденциальности.',
    },
    language: {
      title: 'Язык',
      body: 'Язык, на котором платформа говорит с вами. Пока вы его не выбрали, используется язык браузера.',
    },
  },
};
