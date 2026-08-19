import { similarity } from './fuzzy.js'

const tests = [
  ['I want to drink coffee', 'I want to drink coffee'],
  ['I want to drink coffee', 'I ordered a coffee'],
  ['I want to drink coffee', 'I want to drink A tea']
]

for (const [a, b] of tests) {
  console.log(a, '<->', b, ':', await similarity(a, b))
}
