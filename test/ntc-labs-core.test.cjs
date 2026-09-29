const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../src/ntc-labs-core.js');

test('pessoa e família são reproduzíveis com a mesma seed e opções',()=>{
  const options={seed:'teste determinístico',culture:'pt-BR',detail:'detalhado',minAge:21,maxAge:55,referenceDate:'2026-09-29'};
  assert.deepEqual(core.generatePerson(options),core.generatePerson(options));
  assert.deepEqual(core.generateFamily({...options,size:6}),core.generateFamily({...options,size:6}));
  assert.notDeepEqual(core.generatePerson(options),core.generatePerson({...options,seed:'outra seed'}));
});

test('árvore familiar mantém idades e vínculos recíprocos coerentes',()=>{
  for(let size=1;size<=8;size++)for(let run=0;run<30;run++){
    const family=core.generateFamily({seed:`${size}-${run}`,size,culture:'pt-PT',detail:'equilibrado'});
    assert.equal(family.members.length,size);
    const byId=new Map(family.members.map(person=>[person.id,person]));
    assert.equal(byId.size,size,'cada pessoa tem id exclusivo');
    for(const person of family.members){
      assert.ok(person.age>=0&&person.age<=110);
      assert.match(person.birthDate,/^\d{4}-\d\d-\d\d$/);
      for(const childId of person.children){const child=byId.get(childId);assert.ok(child);assert.ok(child.age<person.age-17);assert.ok(child.parents.includes(person.id));}
      for(const parentId of person.parents){const parent=byId.get(parentId);assert.ok(parent);assert.ok(parent.children.includes(person.id));}
      for(const siblingId of person.siblings){const sibling=byId.get(siblingId);assert.ok(sibling);assert.ok(sibling.siblings.includes(person.id));}
      if(person.partner){const partner=byId.get(person.partner);assert.ok(partner);assert.equal(partner.partner,person.id);}
    }
  }
});

test('Daily Random produz os mesmos itens por data e muda entre dias',()=>{
  const today=core.dailyRandom('2026-09-29'),again=core.dailyRandom('2026-09-29'),tomorrow=core.dailyRandom('2026-09-30');
  assert.deepEqual(today,again);
  assert.notDeepEqual(today,tomorrow);
  assert.equal(today.date,'2026-09-29');
  assert.ok(today.die>=1&&today.die<=20);
  assert.ok(['Cara','Coroa'].includes(today.coin));
  assert.ok(today.challenge.length>10&&today.card.includes(' de '));
});

test('parser de medidas aplica separadores locais, prefixos e fatores corretos',()=>{
  assert.equal(core.parseMeasure('1 bilhão de segundos').valueBase,1_000_000_000);
  assert.equal(core.parseMeasure('1,5 milhão de horas').valueBase,1_500_000*3600);
  assert.equal(core.parseMeasure('384.400 km').valueBase,384_400_000);
  assert.equal(core.parseMeasure('1 TB').valueBase,1_000_000_000_000);
  assert.equal(core.parseMeasure('100 toneladas').valueBase,100_000);
  assert.equal(core.parseMeasure('100 milhões de litros').valueBase,100_000_000);
});

test('comparações de realidade são aproximadas, dimensionais e transparentes',()=>{
  const seconds=core.compareMeasure('1 bilhão de segundos');
  assert.equal(seconds.dimension,'time');assert.equal(seconds.approximate,true);assert.ok(seconds.comparisons.some(value=>value.includes('anos')));
  const distance=core.compareMeasure('40.075 km');
  assert.ok(distance.comparisons.some(value=>value.includes('voltas na circunferência')));
  const pages=core.compareMeasure('1 milhão de páginas');
  assert.ok(pages.comparisons.some(value=>value.includes('livros com 300 páginas')));
  assert.ok(!pages.comparisons.some(value=>value.includes('pessoas')),'não compara grandezas incompatíveis');
  assert.throws(()=>core.parseMeasure('1 unidade desconhecida'),/não reconhecida/);
  assert.throws(()=>core.parseMeasure('-2 km'));
  assert.throws(()=>core.compareMeasure('999999999999999999999999999999999999999999 TB'),/grande demais/);
});
