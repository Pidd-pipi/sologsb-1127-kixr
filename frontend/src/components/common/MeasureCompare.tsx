import { Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { TableProps } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import type { MeasureCompareResult } from '../../utils/measures';

interface MeasureCompareProps {
  result: MeasureCompareResult;
  /** 紧凑模式（整改表格展开行用） */
  size?: TableProps['size'];
}

function fmt(v: number | null, unit: string): string {
  return v === null || v === undefined ? '—' : `${v}${unit}`;
}

/**
 * 工单外部实测 vs 点位最新核验：
 * 两边都留并标明来源；对不上时整行标红；任一来源缺测只展示已上报的一侧。
 */
export default function MeasureCompare({ result, size = 'small' }: MeasureCompareProps) {
  return (
    <Table
      rowKey="label"
      size={size}
      pagination={false}
      dataSource={result.items}
      data-testid="measure-compare"
      columns={[
        { title: '指标', dataIndex: 'label', width: 90 },
        {
          title: (
            <Tooltip title="热线/群众来件所附实测，原文留档不覆盖">
              <Space size={4}>
                工单上报
                <InfoCircleOutlined />
              </Space>
            </Tooltip>
          ),
          width: 150,
          render: (_, row) =>
            row.external === null ? (
              <Typography.Text type="secondary">未提供</Typography.Text>
            ) : (
              <Tag color="orange" data-source="complaint">
                {fmt(row.external, row.unit)}
              </Tag>
            ),
        },
        {
          title: (
            <Tooltip title="督导员对点位的最新一次核验，核验一变即重算">
              <Space size={4}>
                点位最新核验
                <InfoCircleOutlined />
              </Space>
            </Tooltip>
          ),
          width: 150,
          render: (_, row) =>
            row.inspected === null || row.inspected === undefined ? (
              <Typography.Text type="secondary">未核验</Typography.Text>
            ) : (
              <Tag color="blue" data-source="inspection">
                {fmt(row.inspected, row.unit)}
              </Tag>
            ),
        },
        {
          title: '对账',
          render: (_, row) => {
            if (row.external === null || row.inspected === null || row.inspected === undefined) {
              return <Typography.Text type="secondary">单源数据，仅留档</Typography.Text>;
            }
            return row.conflict ? (
              <Tag color="error" data-testid={`conflict-${row.label}`}>
                两边不一致，均保留待核
              </Tag>
            ) : (
              <Tag color="success">基本一致</Tag>
            );
          },
        },
      ]}
      rowClassName={(row) => (row.conflict ? 'gb-measure-conflict' : '')}
    />
  );
}
