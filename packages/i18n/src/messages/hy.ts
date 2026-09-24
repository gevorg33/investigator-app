import type { Catalog } from './catalog.js';

/**
 * Armenian. Typed against the English catalog: a missing key, an extra key or a wrong nesting is a
 * compile error, so the build fails (T-128). Not yet reviewed by a native speaker (ACTIONS-FOR-ME).
 * Armenian ends a sentence with `։` (verjaket), not a full stop.
 */
export const hy: Catalog = {
  app: {
    name: 'Investigator',
  },
  shell: {
    skip_to_content: 'Անցնել բովանդակությանը',
    nav: {
      label: 'Հիմնական',
    },
  },
  nav: {
    home: 'Գլխավոր',
    missions: 'Գործեր',
    messages: 'Զրույցներ',
    assistant: 'Օգնական',
    account: 'Հաշիվ',
  },
  home: {
    empty: {
      title: 'Դեռ ոչինչ ձեր ուշադրությանը չի սպասում',
      body: 'Այստեղ կհավաքվեն դիտարկման սպասող գնառաջարկները, նոր հաղորդագրությունները և գործերի թարմացումները։',
    },
  },
  missions: {
    empty: {
      title: 'Գործեր դեռ չկան',
      body: 'Այստեղ կցուցադրվեն ձեր ստեղծած գործերը, կամ նրանք, որոնց վրա աշխատում եք որպես դետեկտիվ։',
    },
  },
  messages: {
    empty: {
      title: 'Զրույցներ դեռ չկան',
      body: 'Այստեղ կհայտնվեն գործերի շուրջ ձեր զրույցները դետեկտիվների և պատվիրատուների հետ։',
    },
  },
  assistant: {
    empty: {
      title: 'Օգնականը շուտով կհայտնվի',
      body: 'Հարցրեք, թե ինչպես է աշխատում հարթակը, կամ նկարագրեք, թե ինչ է ձեզ պետք, և այն կգտնի համապատասխան դետեկտիվներ։',
    },
  },
  account: {
    empty: {
      title: 'Ձեր հաշիվը',
      body: 'Այստեղ կկառավարեք ձեր պրոֆիլը, մուտքը և գաղտնիության կարգավորումները։',
    },
    language: {
      title: 'Լեզու',
      body: 'Լեզուն, որով հարթակը շփվում է ձեզ հետ։ Քանի դեռ չեք ընտրել, օգտագործվում է ձեր դիտարկչի լեզուն։',
    },
  },
};
