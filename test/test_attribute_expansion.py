# Copyright (C) 2026 Darkmine Pty Ltd

import json
import pandas as pd
import pytest
import baselode.datamodel.attributes


def attrs(rows):
    return pd.DataFrame(rows, columns=['parent_id','attribute_id','name','value','modified_date'])


def test_rank_conflict_and_lossless_records():
    parent = pd.DataFrame({'id':[3,1], 'from':[5.,2.], 'to':[1.,4.]})
    source = attrs([[1,1,'Lith Code','A','2020-01-01'],[1,2,'lith_code','B','2021-01-01'],
                    [1,3,'other-name',None,None],[1,4,'Other Name',' raw ',None]])
    result = baselode.datamodel.attributes.promote_attributes(parent,source,
        [{'name':'lith code','target':'lithology','priority':1}],['lithology'],parent_key='id')
    assert result['id'].tolist() == [3,1]
    assert result['from'].tolist() == [5.,2.]
    assert result.loc[1,'lithology'] == 'B'
    assert result.loc[1,'attribute_clash_count'] == 1
    extra = json.loads(result.loc[1,'attributes_extra'])
    assert set(extra['other_name']) == {None,' raw '}
    assert len(extra['_attribute_records']) == 4
    assert extra['_conflicts']['lithology'][0]['selected'] is True
    assert extra['_conflicts']['lithology'][1]['source_record']['value'] == 'A'


def test_blank_does_not_mask_lower_priority_value():
    source = attrs([[1,1,'preferred','  ',None],[1,2,'fallback',' SSD ',None]])
    mapping = [{'name':'preferred','target':'lithology','priority':0},
               {'name':'fallback','target':'lithology','priority':1}]
    result = baselode.datamodel.attributes.promote_attributes(pd.DataFrame({'parent_id':[1]}),source,mapping,['lithology'])
    assert result.loc[0,'lithology'] == 'SSD'
    assert json.loads(result.loc[0,'attributes_extra'])['_attribute_records'][0]['value'] == '  '


def test_unknown_targets_normalized_map_collisions_and_orphans_fail():
    parent = pd.DataFrame({'parent_id':[1]})
    source = attrs([[1,1,'a','x',None]])
    with pytest.raises(ValueError,match='no output column'):
        baselode.datamodel.attributes.promote_attributes(parent,source,[{'name':'a','target':'missing','priority':1}],['lithology'])
    with pytest.raises(ValueError,match='Ambiguous'):
        baselode.datamodel.attributes.promote_attributes(parent,source,
            [{'name':'A B','target':'lithology','priority':1},{'name':'a-b','target':'lithology','priority':2}],['lithology'])
    source.loc[0,'parent_id']=2
    with pytest.raises(ValueError,match='orphan'):
        baselode.datamodel.attributes.promote_attributes(parent,source,[],['lithology'])


def test_empty_attributes_and_parquet_roundtrip(tmp_path):
    parent=pd.DataFrame({'parent_id':[1]})
    result=baselode.datamodel.attributes.promote_attributes(parent,attrs([]),[],['lithology'])
    result.to_parquet(tmp_path/'one.parquet')
    loaded=pd.read_parquet(tmp_path/'one.parquet')
    assert json.loads(loaded.loc[0,'attributes_extra']) == {}
    assert pd.isna(loaded.loc[0,'lithology'])


def test_priority_and_numeric_text_contracts():
    parent = pd.DataFrame({'parent_id': [1]})
    source = attrs([[1, 1, 'a', '12', None]])
    for priority in (1.5, True, '1'):
        with pytest.raises(ValueError, match='integer'):
            baselode.datamodel.attributes.promote_attributes(parent, source,
                [{'name':'a','target':'lithology','priority':priority}], ['lithology'])
    source['value'] = 12.0
    with pytest.raises(ValueError, match='text or null'):
        baselode.datamodel.attributes.promote_attributes(parent, source, [{'name':'a','target':'lithology','priority':1}], ['lithology'])


def test_scalar_metadata_and_conflict_source_namespaces():
    import datetime
    import decimal
    parent = pd.DataFrame({'parent_id':[1]})
    source = attrs([[1,1,'a','X',None],[1,2,'b','Y',None]])
    source['priority'] = 'source priority'
    source['selected'] = 'source selected'
    source['_time'] = 'source time'
    source['date_metadata'] = datetime.date(2020,1,2)
    source['decimal_metadata'] = decimal.Decimal('0.1234567890123456789')
    source['bytes_metadata'] = b'abc'
    source['infinite_metadata'] = float('inf')
    result = baselode.datamodel.attributes.promote_attributes(parent, source,
        [{'name':'a','target':'lithology','priority':1},{'name':'b','target':'lithology','priority':2}], ['lithology'])
    extra = json.loads(result.loc[0,'attributes_extra'])
    evidence = extra['_conflicts']['lithology'][0]['source_record']
    assert evidence['priority'] == 'source priority'
    assert evidence['selected'] == 'source selected'
    assert evidence['_time'] == 'source time'
    assert evidence['date_metadata'] == '2020-01-02'
    assert evidence['decimal_metadata']['value'] == '0.1234567890123456789'
    assert evidence['bytes_metadata']['value'] == 'YWJj'
    assert evidence['infinite_metadata']['value'] == 'inf'


def test_reserved_fields_natural_text_ids_and_date_validation():
    parent=pd.DataFrame({'parent_id':[1]})
    source=attrs([[1,'A10','a','X',None],[1,'A9','a','Y',None]])
    mapping=[{'name':'a','target':'lithology','priority':1}]
    result=baselode.datamodel.attributes.promote_attributes(parent,source,mapping,['lithology'])
    assert result.loc[0,'lithology']=='Y'
    with pytest.raises(ValueError,match='reserved'):
        baselode.datamodel.attributes.promote_attributes(parent,source,[],['attributes_extra'])
    source=attrs([[1,10,'a','X',None],[1,'A9','a','Y',None]])
    with pytest.raises(ValueError,match='Mixed'):
        baselode.datamodel.attributes.promote_attributes(parent,source,mapping,['lithology'])
    source=attrs([[1,1,'a','X',123]])
    with pytest.raises(ValueError,match='Invalid modified_date'):
        baselode.datamodel.attributes.promote_attributes(parent,source,mapping,['lithology'])
    source=attrs([[1,1,'a','X','not a date']])
    with pytest.raises(ValueError,match='Invalid modified_date'):
        baselode.datamodel.attributes.promote_attributes(parent,source,mapping,['lithology'])


def test_fractional_dates_unicode_ids_and_numeric_extras():
    parent=pd.DataFrame({'parent_id':[1]})
    source=attrs([[1,'X1²','a','X','2020-01-01T10:00:00.123456789Z'],
                  [1,'X2','a','Y','2020-01-01T10:00:00.5Z'],
                  [1,'X3','rare',12.5,123]])
    result=baselode.datamodel.attributes.promote_attributes(parent,source,
        [{'name':'a','target':'lithology','priority':1}],['lithology'])
    assert result.loc[0,'lithology']=='Y'
    extra=json.loads(result.loc[0,'attributes_extra'])
    assert extra['rare']==12.5
    assert len(extra['_attribute_records'])==3


def test_relative_modification_dates_are_not_clock_dependent():
    parent=pd.DataFrame({'parent_id':[1]})
    for text in ('today','now','Jan 1'):
        source=attrs([[1,1,'a','X',text]])
        with pytest.raises(ValueError,match='Invalid modified_date'):
            baselode.datamodel.attributes.promote_attributes(parent,source,
                [{'name':'a','target':'lithology','priority':1}],['lithology'])
