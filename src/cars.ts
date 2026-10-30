import {graphql, type Send} from './transport.ts';
const QUERY=`query HoppCars($region:Int!,$offset:Int!,$limit:Int!) {
  cars:allVehicles(regionId:$region,limitFromCenter:false,offset:$offset,limit:$limit,filter:{vehicleTypeGroups:[CAR]}) {
    id code licensePlate latitude longitude status range vehicleType {id type group image {lightUrl}}
  }
}`;
export async function cars(region=1,model='',send?: Send) {
  if(!Number.isSafeInteger(region)||region<1)throw new Error('Invalid region');
  const all: any[]=[];
  for(let offset=0;offset<10000;offset+=500) {
    const result=await graphql(QUERY,'HoppCars',{region,offset,limit:500},false,send);
    if(!Array.isArray(result.cars)) throw new Error('Invalid vehicle list; no empty inventory inferred');
    all.push(...result.cars);
    if(result.cars.length<500) {
      const unique=[...new Map(all.map(v=>[v.id,v])).values()];
      const counts: Record<string,number>={};
      const rows=unique.map(v=> {
        const image=v.vehicleType?.image?.lightUrl??'';
        const model=image.includes('buzz')?'VW ID. Buzz':image.includes('id3')?'VW ID.3':image.includes('zoe')?'Renault Zoe':image.split('/').pop();
        counts[model]=(counts[model]??0)+1;
        return {code:v.code,licensePlate:v.licensePlate,model,status:v.status,rangeKm:v.range,latitude:v.latitude,longitude:v.longitude,mapUrl:`https://www.google.com/maps?q=${v.latitude},${v.longitude}`};
      });
      return {checkedAt:new Date().toISOString(),region,listedCars:unique.length,models:counts,cars:rows.filter(v=>v.model.toLowerCase().includes(model.toLowerCase()))};
    }
  }
  throw new Error('Vehicle list exceeded pagination bound; coverage incomplete');
}
