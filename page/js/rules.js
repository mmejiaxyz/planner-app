/* Planner rules in one place. The page, the organizer and the prompts read these; change them here only.
   These are the defaults for anyone. A person's own values come from their profile (`profile.rules` in plan.json,
   applied by applyProfile in profile.js), so nothing here names a person, a school or a course. */
const RULES_CFG = {
  dayStart: 9*60,        // work starts at 09:00
  dayEnd: 22*60,         // and stops at 22:00
  heavy: 7,              // hours of work a day: warn above this, never plan past it
  commuteCap: 2,         // hours of train (laptop) and of metro (phone) work per commute day, each
  aheadDays: 7,          // today is topped up only from work planned this close
  maxEarly: 14,          // days before the last day it can start (its deadline, earlier for big or crowded work) a task may be pulled
  levelTol: 1,           // hours a day may sit over the even daily share before it hands work to a lighter day
  leaveBefore: 150,      // minutes before the first class at the main place that one leaves home
  homeAfterCommute: 120, // minutes from the last thing at the main place (a commute away) to home
  homeAfterOther: 60,    // minutes from any other in-person event to home
  deskOnly: [],          // course ids never done on the train or in the metro (a course's own `deskOnly: true` also counts)
  waitsForWeek: [],      // course ids the organizer never moves (a course's own `fixed: true` also counts)
  autoLink: [],          // groups whose open tasks get their course files linked by the model (autoLink in filing.js)
  unsharedGroups: ['Personal', 'Other'],   // groups whose courses do not share sources in Get help
  splitAt: 2,            // tasks over this many hours are split into parts when they are added
  readPace: 12,          // pages an hour for a reading until one's own pace is known
  followUpDays: 3,       // days waiting on someone before the planner suggests a follow-up
  riskTol: 1,            // hours a deadline may be short before it is shown as at risk
};
if(typeof module!=='undefined' && module.exports) module.exports = RULES_CFG;
